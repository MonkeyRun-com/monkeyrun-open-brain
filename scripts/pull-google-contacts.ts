#!/usr/bin/env -S deno run --allow-net --allow-read --allow-write --allow-env

/**
 * Open Brain — Google Contacts Import Script
 *
 * Fetches contacts from Google People API, maps to CRM schema,
 * infers relationships via GPT-4o-mini, generates embeddings,
 * and upserts into the contacts table via Supabase RPC.
 *
 * Usage:
 *   deno run --allow-net --allow-read --allow-write --allow-env scripts/pull-google-contacts.ts [options]
 *
 * Options:
 *   --limit=N       Only process first N contacts (default: no limit)
 *   --dry-run       Show what would be imported without writing
 *   --force         Re-import even if already in sync log
 *   --verbose       Show full contact details during processing
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ─── Configuration ───────────────────────────────────────────────────────────

const SCRIPT_DIR = new URL(".", import.meta.url).pathname;
const CREDENTIALS_PATH = `${SCRIPT_DIR}credentials.json`;
const TOKEN_PATH = `${SCRIPT_DIR}token-contacts.json`;
const SYNC_LOG_PATH = `${SCRIPT_DIR}google-contacts-sync-log.json`;

const PEOPLE_API = "https://people.googleapis.com/v1";
const SCOPES = ["https://www.googleapis.com/auth/contacts.readonly"];

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY") || "";
const OPENROUTER_BASE = "https://openrouter.ai/api/v1";

// ─── Sync Log (deduplication) ────────────────────────────────────────────────

interface SyncLog {
  imported_ids: Record<string, string>; // Google resourceName -> ISO timestamp
  last_sync: string;
}

async function loadSyncLog(): Promise<SyncLog> {
  try {
    const text = await Deno.readTextFile(SYNC_LOG_PATH);
    return JSON.parse(text);
  } catch {
    return { imported_ids: {}, last_sync: "" };
  }
}

async function saveSyncLog(log: SyncLog): Promise<void> {
  await Deno.writeTextFile(SYNC_LOG_PATH, JSON.stringify(log, null, 2));
}

// ─── CLI Argument Parsing ────────────────────────────────────────────────────

interface CliArgs {
  limit: number;
  dryRun: boolean;
  force: boolean;
  verbose: boolean;
}

function parseArgs(): CliArgs {
  const args: CliArgs = {
    limit: 0, // 0 = no limit
    dryRun: false,
    force: false,
    verbose: false,
  };

  for (const arg of Deno.args) {
    if (arg.startsWith("--limit=")) {
      args.limit = parseInt(arg.split("=")[1], 10);
    } else if (arg === "--dry-run") {
      args.dryRun = true;
    } else if (arg === "--force") {
      args.force = true;
    } else if (arg === "--verbose") {
      args.verbose = true;
    }
  }

  return args;
}

// ─── OAuth2 Flow ─────────────────────────────────────────────────────────────

interface OAuthCredentials {
  installed: {
    client_id: string;
    client_secret: string;
    redirect_uris: string[];
  };
}

interface TokenData {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expiry_date: number;
}

async function loadCredentials(): Promise<OAuthCredentials> {
  try {
    const text = await Deno.readTextFile(CREDENTIALS_PATH);
    return JSON.parse(text);
  } catch {
    console.error(`\nNo credentials.json found at: ${CREDENTIALS_PATH}`);
    console.error("\nTo set up Google API access:");
    console.error("  1. Go to https://console.cloud.google.com/apis/credentials");
    console.error("  2. Create an OAuth 2.0 Client ID (type: Desktop app)");
    console.error("  3. Download the JSON and save it as scripts/credentials.json");
    console.error("  4. Enable the People API at https://console.cloud.google.com/apis/library/people.googleapis.com");
    Deno.exit(1);
  }
}

async function loadToken(): Promise<TokenData | null> {
  try {
    const text = await Deno.readTextFile(TOKEN_PATH);
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function saveToken(token: TokenData): Promise<void> {
  await Deno.writeTextFile(TOKEN_PATH, JSON.stringify(token, null, 2));
}

async function refreshAccessToken(
  creds: OAuthCredentials,
  token: TokenData,
): Promise<TokenData> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: creds.installed.client_id,
      client_secret: creds.installed.client_secret,
      refresh_token: token.refresh_token,
      grant_type: "refresh_token",
    }),
  });

  const data = await res.json();
  if (data.error) {
    throw new Error(`Token refresh failed: ${data.error_description || data.error}`);
  }

  const updated: TokenData = {
    access_token: data.access_token,
    refresh_token: token.refresh_token,
    token_type: data.token_type,
    expiry_date: Date.now() + data.expires_in * 1000,
  };
  await saveToken(updated);
  return updated;
}

async function authorize(creds: OAuthCredentials): Promise<string> {
  let token = await loadToken();

  if (token) {
    if (Date.now() < token.expiry_date - 60_000) {
      return token.access_token;
    }
    console.log("Access token expired, refreshing...");
    token = await refreshAccessToken(creds, token);
    return token.access_token;
  }

  // First-time auth: open browser for consent
  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("client_id", creds.installed.client_id);
  authUrl.searchParams.set("redirect_uri", "http://localhost:3847/callback");
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", SCOPES.join(" "));
  authUrl.searchParams.set("access_type", "offline");
  authUrl.searchParams.set("prompt", "consent");

  console.log("\nOpen this URL in your browser to authorize:\n");
  console.log(authUrl.toString());
  console.log("\nWaiting for authorization...");

  // Spin up a tiny local server to catch the redirect
  const code = await new Promise<string>((resolve) => {
    const server = Deno.serve({ port: 3847, onListen: () => {} }, (req) => {
      const url = new URL(req.url);
      const authCode = url.searchParams.get("code");
      if (authCode) {
        resolve(authCode);
        setTimeout(() => server.shutdown(), 100);
        return new Response(
          "<html><body><h2>Authorization complete!</h2><p>You can close this tab and return to your terminal.</p></body></html>",
          { headers: { "Content-Type": "text/html" } },
        );
      }
      return new Response("Waiting for auth...", { status: 400 });
    });
  });

  // Exchange code for tokens
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: creds.installed.client_id,
      client_secret: creds.installed.client_secret,
      redirect_uri: "http://localhost:3847/callback",
      grant_type: "authorization_code",
    }),
  });

  const tokenData = await tokenRes.json();
  if (tokenData.error) {
    throw new Error(`Token exchange failed: ${tokenData.error_description || tokenData.error}`);
  }

  const newToken: TokenData = {
    access_token: tokenData.access_token,
    refresh_token: tokenData.refresh_token,
    token_type: tokenData.token_type,
    expiry_date: Date.now() + tokenData.expires_in * 1000,
  };
  await saveToken(newToken);
  console.log("\nAuthorization successful! Token saved.\n");
  return newToken.access_token;
}

// ─── People API Helpers ──────────────────────────────────────────────────────

async function peopleFetch(accessToken: string, url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`People API error ${res.status}: ${body}`);
  }
  return res.json();
}

interface ContactGroup {
  resourceName: string;
  name: string;
  formattedName: string;
  groupType: string;
}

async function fetchContactGroups(accessToken: string): Promise<Map<string, string>> {
  const data = (await peopleFetch(
    accessToken,
    `${PEOPLE_API}/contactGroups?pageSize=1000`,
  )) as { contactGroups?: ContactGroup[] };

  const map = new Map<string, string>();
  for (const g of data.contactGroups || []) {
    map.set(g.resourceName, g.formattedName || g.name);
  }
  return map;
}

// deno-lint-ignore no-explicit-any
interface GooglePerson { [key: string]: any }

const PERSON_FIELDS = [
  "names", "emailAddresses", "phoneNumbers", "organizations",
  "biographies", "memberships", "metadata", "birthdays",
  "addresses", "urls", "relations",
].join(",");

async function fetchAllContacts(accessToken: string): Promise<GooglePerson[]> {
  const contacts: GooglePerson[] = [];
  let pageToken: string | undefined;

  while (true) {
    let url = `${PEOPLE_API}/people/me/connections?pageSize=100&personFields=${PERSON_FIELDS}&sortOrder=LAST_MODIFIED_DESCENDING`;
    if (pageToken) url += `&pageToken=${pageToken}`;

    const data = (await peopleFetch(accessToken, url)) as {
      connections?: GooglePerson[];
      nextPageToken?: string;
      totalPeople?: number;
    };

    if (data.connections) {
      contacts.push(...data.connections);
    }

    console.log(`  Fetched ${contacts.length} contacts so far...`);

    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }

  return contacts;
}

// ─── Filtering ───────────────────────────────────────────────────────────────

function isSparseContact(person: GooglePerson): boolean {
  const hasName = person.names?.[0]?.displayName;
  if (!hasName) return true;

  const hasEmail = person.emailAddresses?.length > 0;
  const hasPhone = person.phoneNumbers?.length > 0;
  const hasOrg = person.organizations?.length > 0;
  const hasNotes = person.biographies?.length > 0;

  // Skip if ALL are missing
  if (!hasEmail && !hasPhone && !hasOrg && !hasNotes) return true;

  return false;
}

// ─── Field Mapping ───────────────────────────────────────────────────────────

interface MappedContact {
  name: string;
  email: string | null;
  phone: string | null;
  organization: string | null;
  role: string | null;
  context: string | null;
  tags: string[];
  last_contact: string | null;
  source_ref: Record<string, unknown>;
  metadata: Record<string, unknown>;
  resourceName: string;
}

function mapContact(
  person: GooglePerson,
  groupMap: Map<string, string>,
): MappedContact {
  const name = person.names?.[0]?.displayName || "";
  const email = person.emailAddresses?.[0]?.value || null;
  const phone = person.phoneNumbers?.[0]?.value || null;
  const organization = person.organizations?.[0]?.name || null;
  const role = person.organizations?.[0]?.title || null;
  const context = person.biographies?.[0]?.value || null;

  // Resolve group memberships to names
  const tags: string[] = [];
  if (person.memberships) {
    for (const m of person.memberships) {
      const groupRef = m.contactGroupMembership?.contactGroupResourceName;
      if (groupRef) {
        const groupName = groupMap.get(groupRef);
        // Skip system groups like "myContacts"
        if (groupName && groupName !== "myContacts" && !groupRef.includes("myContacts")) {
          tags.push(groupName);
        }
      }
    }
  }

  // Best proxy for last contact date
  const updateTime = person.metadata?.sources?.[0]?.updateTime || null;
  const last_contact = updateTime ? new Date(updateTime).toISOString() : null;

  const source_ref = {
    resourceName: person.resourceName,
    importedAt: new Date().toISOString(),
  };

  // Extra fields as JSONB metadata
  const extra: Record<string, unknown> = {};
  if (person.birthdays?.[0]?.date) {
    const bd = person.birthdays[0].date;
    extra.birthday = `${bd.year || "????"}-${String(bd.month).padStart(2, "0")}-${String(bd.day).padStart(2, "0")}`;
  }
  if (person.addresses?.length) {
    extra.addresses = person.addresses.map(
      // deno-lint-ignore no-explicit-any
      (a: any) => a.formattedValue || a.streetAddress || null,
    ).filter(Boolean);
  }
  if (person.urls?.length) {
    // deno-lint-ignore no-explicit-any
    extra.urls = person.urls.map((u: any) => u.value).filter(Boolean);
  }
  if (person.relations?.length) {
    // deno-lint-ignore no-explicit-any
    extra.relations = person.relations.map((r: any) => ({
      name: r.person,
      type: r.type,
    }));
  }

  return {
    name,
    email,
    phone,
    organization,
    role,
    context,
    tags,
    last_contact,
    source_ref,
    metadata: extra,
    resourceName: person.resourceName,
  };
}

// ─── Relationship Inference ──────────────────────────────────────────────────

const VALID_RELATIONSHIPS = [
  "advisor", "investor", "founder", "medical", "family",
  "friend", "colleague", "client", "vendor", "acquaintance",
];

async function inferRelationship(
  contact: MappedContact,
): Promise<string | null> {
  // Skip LLM call if no meaningful signals
  if (!contact.context && !contact.organization && contact.tags.length === 0) {
    return null;
  }

  const signals: string[] = [`Name: ${contact.name}`];
  if (contact.organization) signals.push(`Organization: ${contact.organization}`);
  if (contact.role) signals.push(`Role: ${contact.role}`);
  if (contact.context) signals.push(`Notes: ${contact.context}`);
  if (contact.tags.length) signals.push(`Groups: ${contact.tags.join(", ")}`);

  const r = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "openai/gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `You classify a person's relationship to a startup CEO named Matt Hallett. Given info about a contact, return JSON with:
- "relationship": one of ${JSON.stringify(VALID_RELATIONSHIPS)}, or null if you can't determine
- "confidence": "high", "medium", or "low"

Only return high or medium confidence results. If low confidence, set relationship to null.`,
        },
        { role: "user", content: signals.join("\n") },
      ],
    }),
  });

  const d = await r.json();
  try {
    const result = JSON.parse(d.choices[0].message.content);
    if (
      result.relationship &&
      VALID_RELATIONSHIPS.includes(result.relationship) &&
      (result.confidence === "high" || result.confidence === "medium")
    ) {
      return result.relationship;
    }
    return null;
  } catch {
    return null;
  }
}

// ─── Embeddings ──────────────────────────────────────────────────────────────

async function getEmbedding(text: string): Promise<number[]> {
  const r = await fetch(`${OPENROUTER_BASE}/embeddings`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "openai/text-embedding-3-small",
      input: text,
    }),
  });
  if (!r.ok) {
    const msg = await r.text().catch(() => "");
    throw new Error(`OpenRouter embeddings failed: ${r.status} ${msg}`);
  }
  const d = await r.json();
  return d.data[0].embedding;
}

function buildContactEmbeddingText(contact: {
  name: string;
  role?: string | null;
  organization?: string | null;
  relationship?: string | null;
  context?: string | null;
  tags?: string[] | null;
}): string {
  const parts = [contact.name];
  if (contact.role && contact.organization) {
    parts.push(`- ${contact.role} at ${contact.organization}`);
  } else if (contact.role) {
    parts.push(`- ${contact.role}`);
  } else if (contact.organization) {
    parts.push(`at ${contact.organization}`);
  }
  if (contact.relationship) parts.push(`. ${contact.relationship}`);
  if (contact.context) parts.push(`. ${contact.context}`);
  if (contact.tags?.length) parts.push(`. Tags: ${contact.tags.join(", ")}`);
  return parts.join(" ");
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs();
  const creds = await loadCredentials();
  const accessToken = await authorize(creds);

  console.log(`\nFetching Google Contacts...`);
  console.log(`  Limit:   ${args.limit || "no limit"}`);
  console.log(`  Mode:    ${args.dryRun ? "DRY RUN (no writes)" : "LIVE"}`);
  console.log(`  Force:   ${args.force ? "yes (re-import all)" : "no (skip already imported)"}`);

  if (!args.dryRun) {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      console.error("\nSUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for live mode.");
      Deno.exit(1);
    }
    if (!OPENROUTER_API_KEY) {
      console.error("\nOPENROUTER_API_KEY is required for embeddings and relationship inference.");
      Deno.exit(1);
    }
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Fetch contact groups for tag resolution
  console.log("\nFetching contact groups...");
  const groupMap = await fetchContactGroups(accessToken);
  console.log(`  Found ${groupMap.size} groups.`);

  // Fetch all contacts
  console.log("\nFetching contacts...");
  const allContacts = await fetchAllContacts(accessToken);
  console.log(`\nTotal contacts from Google: ${allContacts.length}`);

  // Filter sparse contacts
  const contacts = allContacts.filter((p) => !isSparseContact(p));
  console.log(`After filtering sparse entries: ${contacts.length}`);

  // Apply limit
  const toProcess = args.limit ? contacts.slice(0, args.limit) : contacts;
  console.log(`Will process: ${toProcess.length}\n`);

  const syncLog = await loadSyncLog();

  let processed = 0;
  let skippedSync = 0;
  let created = 0;
  let updated = 0;
  let errors = 0;
  let relationshipsInferred = 0;

  for (const person of toProcess) {
    const resourceName = person.resourceName;

    // Dedup via sync log
    if (!args.force && syncLog.imported_ids[resourceName]) {
      skippedSync++;
      continue;
    }

    const mapped = mapContact(person, groupMap);
    processed++;

    console.log(`${processed}. ${mapped.name}`);
    if (mapped.organization || mapped.role) {
      console.log(`   ${mapped.role || ""}${mapped.role && mapped.organization ? " at " : ""}${mapped.organization || ""}`);
    }
    if (mapped.email) console.log(`   Email: ${mapped.email}`);
    if (mapped.tags.length) console.log(`   Groups: ${mapped.tags.join(", ")}`);

    if (args.verbose) {
      if (mapped.phone) console.log(`   Phone: ${mapped.phone}`);
      if (mapped.context) console.log(`   Notes: ${mapped.context.substring(0, 150)}${mapped.context.length > 150 ? "..." : ""}`);
      if (Object.keys(mapped.metadata).length) console.log(`   Metadata: ${JSON.stringify(mapped.metadata)}`);
    }

    if (args.dryRun) {
      console.log(`   -> Would import`);
      console.log();
      continue;
    }

    try {
      // Infer relationship and generate embedding in parallel
      const [relationship, embedding] = await Promise.all([
        inferRelationship(mapped),
        getEmbedding(
          buildContactEmbeddingText({
            ...mapped,
            relationship: null, // Don't include in embedding yet, we haven't inferred it
          }),
        ),
      ]);

      if (relationship) {
        relationshipsInferred++;
        console.log(`   Relationship: ${relationship}`);
      }

      // If we got a relationship, regenerate embedding with it included
      let finalEmbedding = embedding;
      if (relationship) {
        finalEmbedding = await getEmbedding(
          buildContactEmbeddingText({ ...mapped, relationship }),
        );
      }

      // Upsert via RPC — fill_gaps_only so curated data isn't overwritten
      const { data, error } = await supabase.rpc("upsert_contact", {
        p_name: mapped.name,
        p_email: mapped.email,
        p_phone: mapped.phone,
        p_organization: mapped.organization,
        p_role: mapped.role,
        p_relationship: relationship,
        p_context: mapped.context,
        p_tags: mapped.tags,
        p_last_contact: mapped.last_contact,
        p_next_followup: null,
        p_followup_note: null,
        p_source_ref: mapped.source_ref,
        p_metadata: Object.keys(mapped.metadata).length > 0 ? mapped.metadata : {},
        p_embedding: finalEmbedding,
        p_fill_gaps_only: true,
      });

      if (error) {
        errors++;
        console.error(`   -> ERROR: ${error.message}`);
      } else {
        const result = data as { id: string; action: string; matched_on: string | null };
        if (result.action === "created") {
          created++;
          console.log(`   -> Created`);
        } else if (result.action === "updated") {
          updated++;
          console.log(`   -> Updated (matched on ${result.matched_on})`);
        } else if (result.action === "disambiguation_needed") {
          errors++;
          console.log(`   -> Disambiguation needed, skipping`);
        }

        // Record in sync log
        syncLog.imported_ids[resourceName] = new Date().toISOString();
      }
    } catch (err) {
      errors++;
      console.error(`   -> ERROR: ${(err as Error).message}`);
    }

    console.log();

    // Rate limit: 200ms between contacts
    await new Promise((r) => setTimeout(r, 200));
  }

  // Save sync log
  if (!args.dryRun) {
    syncLog.last_sync = new Date().toISOString();
    await saveSyncLog(syncLog);
  }

  // Summary
  console.log("\u2500".repeat(60));
  console.log("Summary:");
  console.log(`  Total from Google:       ${allContacts.length}`);
  console.log(`  After filtering:         ${contacts.length}`);
  console.log(`  Already imported:        ${skippedSync} (skipped)`);
  console.log(`  Processed:               ${processed}`);
  if (!args.dryRun) {
    console.log(`  Created:                 ${created}`);
    console.log(`  Updated:                 ${updated}`);
    console.log(`  Relationships inferred:  ${relationshipsInferred}`);
    console.log(`  Errors:                  ${errors}`);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  Deno.exit(1);
});
