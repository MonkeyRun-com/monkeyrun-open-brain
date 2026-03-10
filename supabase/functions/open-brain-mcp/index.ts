import "jsr:@supabase/functions-js/edge-runtime.d.ts";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPTransport } from "@hono/mcp";
import { Hono } from "hono";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY")!;
const MCP_ACCESS_KEY = Deno.env.get("MCP_ACCESS_KEY")!;

const OPENROUTER_BASE = "https://openrouter.ai/api/v1";
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const USER_TIMEZONE = "America/Los_Angeles";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { timeZone: USER_TIMEZONE });
}

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

async function extractMetadata(text: string): Promise<Record<string, unknown>> {
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
          content: `Extract metadata from the user's captured thought. Return JSON with:
- "people": array of people mentioned (empty if none)
- "action_items": array of implied to-dos (empty if none)
- "dates_mentioned": array of dates YYYY-MM-DD (empty if none)
- "topics": array of 1-3 short topic tags (always at least one)
- "type": one of "observation", "task", "idea", "reference", "person_note"
- "sentiment": one of "positive", "negative", "neutral", "mixed"
Only extract what's explicitly there.`,
        },
        { role: "user", content: text },
      ],
    }),
  });
  const d = await r.json();
  try {
    return JSON.parse(d.choices[0].message.content);
  } catch {
    return { topics: ["uncategorized"], type: "observation" };
  }
}

const server = new McpServer({
  name: "open-brain",
  version: "1.0.0",
});

server.registerTool(
  "search_thoughts",
  {
    title: "Search Thoughts",
    description:
      "Search captured thoughts by meaning. Use this when the user asks about a topic, person, or idea they've previously captured.",
    inputSchema: {
      query: z.string().describe("What to search for"),
      limit: z.number().optional().default(10),
      threshold: z.number().optional().default(0.1),
      include_full_text: z.boolean().optional().default(false).describe("Include the full original source text in results (emails, conversations, etc.)"),
    },
  },
  async ({ query, limit, threshold, include_full_text }) => {
    try {
      const qEmb = await getEmbedding(query);
      // Fetch extra results to account for chunk deduplication
      const { data, error } = await supabase.rpc("match_thoughts", {
        query_embedding: qEmb,
        match_threshold: threshold,
        match_count: limit * 3,
        filter: {},
      });

      if (error) {
        return {
          content: [{ type: "text" as const, text: `Search error: ${error.message}` }],
          isError: true,
        };
      }

      if (!data || data.length === 0) {
        return {
          content: [{ type: "text" as const, text: `No thoughts found matching "${query}".` }],
        };
      }

      // Deduplicate chunks from the same parent document
      const seenParents = new Set<string>();
      const dedupedResults: typeof data = [];

      for (const t of data) {
        if (t.parent_id) {
          if (seenParents.has(t.parent_id)) continue;
          seenParents.add(t.parent_id);
        }
        dedupedResults.push(t);
        if (dedupedResults.length >= limit) break;
      }

      // Count how many sibling chunks matched per parent
      const parentChunkCounts: Record<string, number> = {};
      for (const t of data) {
        if (t.parent_id) {
          parentChunkCounts[t.parent_id] = (parentChunkCounts[t.parent_id] || 0) + 1;
        }
      }

      const results = dedupedResults.map(
        (
          t: {
            id: string;
            content: string;
            full_text: string | null;
            metadata: Record<string, unknown>;
            similarity: number;
            created_at: string;
            parent_id: string | null;
            chunk_index: number | null;
          },
          i: number
        ) => {
          const m = t.metadata || {};
          const sourceRef = m.source_ref as Record<string, string> | undefined;
          const parts = [
            `--- Result ${i + 1} (${(t.similarity * 100).toFixed(1)}% match) ---`,
            `Captured: ${formatDate(t.created_at)}`,
            `Type: ${m.type || "unknown"}`,
          ];
          if (t.parent_id && parentChunkCounts[t.parent_id] > 1) {
            parts.push(`Note: ${parentChunkCounts[t.parent_id]} sections of this document matched`);
          }
          if (Array.isArray(m.topics) && m.topics.length)
            parts.push(`Topics: ${(m.topics as string[]).join(", ")}`);
          if (Array.isArray(m.people) && m.people.length)
            parts.push(`People: ${(m.people as string[]).join(", ")}`);
          if (Array.isArray(m.action_items) && m.action_items.length)
            parts.push(`Actions: ${(m.action_items as string[]).join("; ")}`);
          if (sourceRef?.url)
            parts.push(`Source: ${sourceRef.url}`);
          parts.push(`\n${t.content}`);
          if (include_full_text && t.full_text)
            parts.push(`\nFull text:\n${t.full_text}`);
          return parts.join("\n");
        }
      );

      return {
        content: [
          {
            type: "text" as const,
            text: `Found ${dedupedResults.length} thought(s):\n\n${results.join("\n\n")}`,
          },
        ],
      };
    } catch (err: unknown) {
      return {
        content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "list_thoughts",
  {
    title: "List Recent Thoughts",
    description:
      "List recently captured thoughts with optional filters by type, topic, person, or time range.",
    inputSchema: {
      limit: z.number().optional().default(10),
      type: z.string().optional().describe("Filter by type: observation, task, idea, reference, person_note"),
      topic: z.string().optional().describe("Filter by topic tag"),
      person: z.string().optional().describe("Filter by person mentioned"),
      days: z.number().optional().describe("Only thoughts from the last N days"),
    },
  },
  async ({ limit, type, topic, person, days }) => {
    try {
      let q = supabase
        .from("thoughts")
        .select("content, metadata, created_at")
        .order("created_at", { ascending: false })
        .limit(limit);

      if (type) q = q.contains("metadata", { type });
      if (topic) q = q.contains("metadata", { topics: [topic] });
      if (person) q = q.contains("metadata", { people: [person] });
      if (days) {
        const since = new Date();
        since.setDate(since.getDate() - days);
        q = q.gte("created_at", since.toISOString());
      }

      const { data, error } = await q;

      if (error) {
        return {
          content: [{ type: "text" as const, text: `Error: ${error.message}` }],
          isError: true,
        };
      }

      if (!data || !data.length) {
        return { content: [{ type: "text" as const, text: "No thoughts found." }] };
      }

      const results = data.map(
        (
          t: { content: string; metadata: Record<string, unknown>; created_at: string },
          i: number
        ) => {
          const m = t.metadata || {};
          const tags = Array.isArray(m.topics) ? (m.topics as string[]).join(", ") : "";
          return `${i + 1}. [${formatDate(t.created_at)}] (${m.type || "??"}${tags ? " - " + tags : ""})\n   ${t.content}`;
        }
      );

      return {
        content: [
          {
            type: "text" as const,
            text: `${data.length} recent thought(s):\n\n${results.join("\n\n")}`,
          },
        ],
      };
    } catch (err: unknown) {
      return {
        content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "thought_stats",
  {
    title: "Thought Statistics",
    description: "Get a summary of all captured thoughts: totals, types, top topics, and people.",
    inputSchema: {},
  },
  async () => {
    try {
      const { count } = await supabase
        .from("thoughts")
        .select("*", { count: "exact", head: true });

      const { data } = await supabase
        .from("thoughts")
        .select("metadata, created_at")
        .order("created_at", { ascending: false });

      const types: Record<string, number> = {};
      const topics: Record<string, number> = {};
      const people: Record<string, number> = {};

      for (const r of data || []) {
        const m = (r.metadata || {}) as Record<string, unknown>;
        if (m.type) types[m.type as string] = (types[m.type as string] || 0) + 1;
        if (Array.isArray(m.topics))
          for (const t of m.topics) topics[t as string] = (topics[t as string] || 0) + 1;
        if (Array.isArray(m.people))
          for (const p of m.people) people[p as string] = (people[p as string] || 0) + 1;
      }

      const sort = (o: Record<string, number>): [string, number][] =>
        Object.entries(o)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10);

      const lines: string[] = [
        `Total thoughts: ${count}`,
        `Date range: ${
          data?.length
            ? formatDate(data[data.length - 1].created_at) +
              " → " +
              formatDate(data[0].created_at)
            : "N/A"
        }`,
        "",
        "Types:",
        ...sort(types).map(([k, v]) => `  ${k}: ${v}`),
      ];

      if (Object.keys(topics).length) {
        lines.push("", "Top topics:");
        for (const [k, v] of sort(topics)) lines.push(`  ${k}: ${v}`);
      }

      if (Object.keys(people).length) {
        lines.push("", "People mentioned:");
        for (const [k, v] of sort(people)) lines.push(`  ${k}: ${v}`);
      }

      // Overdue follow-ups count from contacts
      const { count: overdueCount } = await supabase
        .from("contacts")
        .select("*", { count: "exact", head: true })
        .lte("next_followup", new Date().toISOString());

      if (overdueCount !== null && overdueCount > 0) {
        lines.push("", `Overdue follow-ups: ${overdueCount}`);
      }

      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    } catch (err: unknown) {
      return {
        content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "email_sync_status",
  {
    title: "Email Sync Status",
    description:
      "Check the status of Gmail email ingestion into Open Brain. Returns total email-sourced thoughts, breakdown by Gmail label, date range of ingested emails, and the most recent sync time.",
    inputSchema: {},
  },
  async () => {
    try {
      const { data, error } = await supabase
        .from("thoughts")
        .select("metadata, created_at")
        .eq("metadata->>source", "gmail")
        .order("created_at", { ascending: false });

      if (error) {
        return {
          content: [{ type: "text" as const, text: `Error: ${error.message}` }],
          isError: true,
        };
      }

      if (!data || data.length === 0) {
        return {
          content: [{ type: "text" as const, text: "No emails have been ingested yet. Run the Gmail pull script to get started:\n  deno run --allow-net --allow-read --allow-write --allow-env scripts/pull-gmail.ts --window=7d --labels=SENT,STARRED" }],
        };
      }

      // Count by label
      const labelCounts: Record<string, number> = {};
      let chunksCount = 0;
      let parentsCount = 0;
      for (const r of data) {
        const m = (r.metadata || {}) as Record<string, unknown>;
        if (Array.isArray(m.gmail_labels)) {
          for (const label of m.gmail_labels as string[]) {
            labelCounts[label] = (labelCounts[label] || 0) + 1;
          }
        }
      }

      // Count parents vs chunks via separate queries
      const { count: parentCount } = await supabase
        .from("thoughts")
        .select("*", { count: "exact", head: true })
        .eq("metadata->>source", "gmail")
        .is("parent_id", null);

      const { count: chunkCount } = await supabase
        .from("thoughts")
        .select("*", { count: "exact", head: true })
        .eq("metadata->>source", "gmail")
        .not("parent_id", "is", null);

      chunksCount = chunkCount || 0;
      parentsCount = parentCount || 0;

      const newest = formatDate(data[0].created_at);
      const oldest = formatDate(data[data.length - 1].created_at);

      const lines = [
        `Email sync status:`,
        `  Total email thoughts: ${data.length} (${parentsCount} documents + ${chunksCount} chunks)`,
        `  Date range: ${oldest} → ${newest}`,
        `  Last ingested: ${newest}`,
        "",
        "By Gmail label:",
        ...Object.entries(labelCounts)
          .sort((a, b) => b[1] - a[1])
          .map(([label, count]) => `  ${label}: ${count}`),
        "",
        "To sync new emails:",
        "  deno run --allow-net --allow-read --allow-write --allow-env scripts/pull-gmail.ts --window=7d --labels=SENT,STARRED",
      ];

      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    } catch (err: unknown) {
      return {
        content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "capture_thought",
  {
    title: "Capture Thought",
    description:
      "Save a new thought to the Open Brain. Generates an embedding and extracts metadata automatically. Use this when the user wants to save something to their brain directly from any AI client — notes, insights, decisions, or migrated content from other systems.",
    inputSchema: {
      content: z.string().describe("The thought to capture — a clear, standalone statement that will make sense when retrieved later by any AI"),
    },
  },
  async ({ content }) => {
    try {
      const [embedding, metadata] = await Promise.all([
        getEmbedding(content),
        extractMetadata(content),
      ]);

      const { error } = await supabase.from("thoughts").insert({
        content,
        embedding,
        metadata: { ...metadata, source: "mcp" },
      });

      if (error) {
        return {
          content: [{ type: "text" as const, text: `Failed to capture: ${error.message}` }],
          isError: true,
        };
      }

      const meta = metadata as Record<string, unknown>;
      let confirmation = `Captured as ${meta.type || "thought"}`;
      if (Array.isArray(meta.topics) && meta.topics.length)
        confirmation += ` — ${(meta.topics as string[]).join(", ")}`;
      if (Array.isArray(meta.people) && meta.people.length)
        confirmation += ` | People: ${(meta.people as string[]).join(", ")}`;
      if (Array.isArray(meta.action_items) && meta.action_items.length)
        confirmation += ` | Actions: ${(meta.action_items as string[]).join("; ")}`;

      return {
        content: [{ type: "text" as const, text: confirmation }],
      };
    } catch (err: unknown) {
      return {
        content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }],
        isError: true,
      };
    }
  }
);

// --- Contact CRM Tools (Issue #5) ---

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

server.registerTool(
  "upsert_contact",
  {
    title: "Create or Update Contact",
    description:
      "Add a new contact or update an existing one in the CRM. Matches by email first, then name+org, then name alone. Merges data on update (appends context, unions tags, keeps latest last_contact).",
    inputSchema: {
      name: z.string().describe("Contact's full name"),
      email: z.string().optional().describe("Email address"),
      phone: z.string().optional().describe("Phone number"),
      organization: z.string().optional().describe("Company or organization"),
      role: z.string().optional().describe("Job title or role"),
      relationship: z.string().optional().describe("advisor, investor, founder, medical, family, friend, colleague, client"),
      context: z.string().optional().describe("Free-form notes: how we know them, background"),
      tags: z.array(z.string()).optional().default([]).describe("Tags for categorization"),
      last_contact: z.string().optional().describe("ISO date of last contact"),
      next_followup: z.string().optional().describe("ISO date for next follow-up"),
      followup_note: z.string().optional().describe("What to follow up about"),
      clear_followup: z.boolean().optional().default(false).describe("Clear existing follow-up (set next_followup and followup_note to null)"),
    },
  },
  async ({ name, email, phone, organization, role, relationship, context, tags, last_contact, next_followup, followup_note, clear_followup }) => {
    try {
      const embeddingText = buildContactEmbeddingText({ name, role, organization, relationship, context, tags });
      const embedding = await getEmbedding(embeddingText);

      const { data, error } = await supabase.rpc("upsert_contact", {
        p_name: name,
        p_email: email || null,
        p_phone: phone || null,
        p_organization: organization || null,
        p_role: role || null,
        p_relationship: relationship || null,
        p_context: context || null,
        p_tags: tags || [],
        p_last_contact: last_contact || null,
        p_next_followup: next_followup || null,
        p_followup_note: followup_note || null,
        p_embedding: embedding,
        p_clear_followup: clear_followup || false,
      });

      if (error) {
        return {
          content: [{ type: "text" as const, text: `Upsert error: ${error.message}` }],
          isError: true,
        };
      }

      const result = data as { id: string; action: string; matched_on: string | null; message?: string; matches?: unknown[] };

      if (result.action === "disambiguation_needed") {
        const matchList = (result.matches as { name: string; organization: string; email: string }[])
          .map((m) => `  - ${m.name}${m.organization ? ` (${m.organization})` : ""}${m.email ? ` <${m.email}>` : ""}`)
          .join("\n");
        return {
          content: [{ type: "text" as const, text: `Multiple contacts match "${name}":\n${matchList}\n\nPlease provide email or organization to disambiguate.` }],
        };
      }

      const actionVerb = result.action === "created" ? "Created" : "Updated";
      const matchInfo = result.matched_on ? ` (matched on ${result.matched_on})` : "";
      return {
        content: [{ type: "text" as const, text: `${actionVerb} contact: ${name}${matchInfo}` }],
      };
    } catch (err: unknown) {
      return {
        content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "lookup_contact",
  {
    title: "Look Up Contact",
    description:
      "Search for contacts by meaning. Use when the user asks about a person, relationship, or role. Returns a dossier with optional recent interactions and related thoughts.",
    inputSchema: {
      query: z.string().describe("Who to search for — name, role, context, etc."),
      limit: z.number().optional().default(5),
      include_interactions: z.boolean().optional().default(true).describe("Include recent interactions"),
      include_thoughts: z.boolean().optional().default(false).describe("Include related thoughts from knowledge base"),
    },
  },
  async ({ query, limit, include_interactions, include_thoughts }) => {
    try {
      const qEmb = await getEmbedding(query);
      const { data, error } = await supabase.rpc("match_contacts", {
        query_embedding: qEmb,
        match_threshold: 0.1,
        match_count: limit,
      });

      if (error) {
        return {
          content: [{ type: "text" as const, text: `Search error: ${error.message}` }],
          isError: true,
        };
      }

      if (!data || data.length === 0) {
        return {
          content: [{ type: "text" as const, text: `No contacts found matching "${query}".` }],
        };
      }

      const dossiers: string[] = [];

      for (const c of data as {
        id: string; name: string; email: string | null; phone: string | null;
        organization: string | null; role: string | null; relationship: string | null;
        context: string | null; tags: string[]; last_contact: string | null;
        next_followup: string | null; followup_note: string | null;
        metadata: Record<string, unknown>; similarity: number; created_at: string;
      }[]) {
        const parts = [
          `--- ${c.name} (${(c.similarity * 100).toFixed(1)}% match) ---`,
        ];
        if (c.role || c.organization) {
          parts.push(`${c.role || ""}${c.role && c.organization ? " at " : ""}${c.organization || ""}`);
        }
        if (c.relationship) parts.push(`Relationship: ${c.relationship}`);
        if (c.email) parts.push(`Email: ${c.email}`);
        if (c.phone) parts.push(`Phone: ${c.phone}`);
        if (c.tags?.length) parts.push(`Tags: ${c.tags.join(", ")}`);
        if (c.last_contact) parts.push(`Last contact: ${formatDate(c.last_contact)}`);
        if (c.next_followup) {
          const isOverdue = new Date(c.next_followup) <= new Date();
          parts.push(`Follow-up: ${formatDate(c.next_followup)}${isOverdue ? " (OVERDUE)" : ""}`);
          if (c.followup_note) parts.push(`Follow-up note: ${c.followup_note}`);
        }
        if (c.context) parts.push(`Context: ${c.context}`);

        // Fetch recent interactions
        if (include_interactions) {
          const { data: interactions } = await supabase
            .from("interactions")
            .select("type, summary, occurred_at")
            .eq("contact_id", c.id)
            .order("occurred_at", { ascending: false })
            .limit(5);

          if (interactions?.length) {
            parts.push("", "Recent interactions:");
            for (const ix of interactions) {
              parts.push(`  [${formatDate(ix.occurred_at)}] (${ix.type}) ${ix.summary}`);
            }
          }
        }

        // Search related thoughts
        if (include_thoughts) {
          const { data: thoughts } = await supabase
            .from("thoughts")
            .select("content, metadata, created_at")
            .contains("metadata", { people: [c.name] })
            .order("created_at", { ascending: false })
            .limit(5);

          if (thoughts?.length) {
            parts.push("", "Related thoughts:");
            for (const t of thoughts) {
              parts.push(`  [${formatDate(t.created_at)}] ${t.content.substring(0, 150)}${t.content.length > 150 ? "..." : ""}`);
            }
          }
        }

        dossiers.push(parts.join("\n"));
      }

      return {
        content: [
          {
            type: "text" as const,
            text: `Found ${data.length} contact(s):\n\n${dossiers.join("\n\n")}`,
          },
        ],
      };
    } catch (err: unknown) {
      return {
        content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "list_contacts",
  {
    title: "List Contacts",
    description:
      "List contacts with optional filters by organization, relationship type, tag, or overdue follow-ups.",
    inputSchema: {
      organization: z.string().optional().describe("Filter by organization (case-insensitive partial match)"),
      relationship: z.string().optional().describe("Filter by relationship type: advisor, investor, founder, medical, family, friend, colleague, client"),
      tag: z.string().optional().describe("Filter by tag"),
      followup_due: z.boolean().optional().default(false).describe("Only show contacts with overdue follow-ups"),
      followup_days: z.number().optional().describe("Show contacts with follow-ups due within N days"),
      limit: z.number().optional().default(20),
    },
  },
  async ({ organization, relationship, tag, followup_due, followup_days, limit }) => {
    try {
      let q = supabase
        .from("contacts")
        .select("id, name, email, organization, role, relationship, tags, last_contact, next_followup, followup_note, context")
        .order("last_contact", { ascending: false, nullsFirst: false })
        .limit(limit);

      if (organization) q = q.ilike("organization", `%${organization}%`);
      if (relationship) q = q.eq("relationship", relationship);
      if (tag) q = q.contains("tags", [tag]);
      if (followup_due) {
        q = q.lte("next_followup", new Date().toISOString());
      } else if (followup_days) {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() + followup_days);
        q = q.lte("next_followup", cutoff.toISOString());
      }

      const { data, error } = await q;

      if (error) {
        return {
          content: [{ type: "text" as const, text: `Error: ${error.message}` }],
          isError: true,
        };
      }

      if (!data || !data.length) {
        return { content: [{ type: "text" as const, text: "No contacts found matching filters." }] };
      }

      const results = data.map(
        (c: {
          name: string; email: string | null; organization: string | null;
          role: string | null; relationship: string | null; tags: string[];
          last_contact: string | null; next_followup: string | null;
          followup_note: string | null; context: string | null;
        }, i: number) => {
          const parts = [`${i + 1}. ${c.name}`];
          if (c.role || c.organization) {
            parts[0] += ` — ${c.role || ""}${c.role && c.organization ? " at " : ""}${c.organization || ""}`;
          }
          if (c.relationship) parts.push(`   Relationship: ${c.relationship}`);
          if (c.tags?.length) parts.push(`   Tags: ${c.tags.join(", ")}`);
          if (c.last_contact) parts.push(`   Last contact: ${formatDate(c.last_contact)}`);
          if (c.next_followup) {
            const isOverdue = new Date(c.next_followup) <= new Date();
            parts.push(`   Follow-up: ${formatDate(c.next_followup)}${isOverdue ? " (OVERDUE)" : ""}${c.followup_note ? ` — ${c.followup_note}` : ""}`);
          }
          return parts.join("\n");
        }
      );

      return {
        content: [
          {
            type: "text" as const,
            text: `${data.length} contact(s):\n\n${results.join("\n\n")}`,
          },
        ],
      };
    } catch (err: unknown) {
      return {
        content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "log_interaction",
  {
    title: "Log Interaction",
    description:
      "Record an interaction with a contact (meeting, call, email, coffee, event, note). Updates last_contact automatically. Optionally set a follow-up date.",
    inputSchema: {
      contact_name: z.string().describe("Name of the contact (case-insensitive match)"),
      type: z.string().optional().default("note").describe("Type: meeting, call, email, coffee, event, note"),
      summary: z.string().describe("What happened / what was discussed"),
      occurred_at: z.string().optional().describe("ISO date when it happened (defaults to now)"),
      next_followup: z.string().optional().describe("ISO date for next follow-up"),
      followup_note: z.string().optional().describe("What to follow up about"),
      clear_followup: z.boolean().optional().default(false).describe("Clear the existing follow-up (use when logging the interaction that was the follow-up)"),
    },
  },
  async ({ contact_name, type, summary, occurred_at, next_followup, followup_note, clear_followup }) => {
    try {
      // Find contact by name (case-insensitive)
      const { data: matches, error: findError } = await supabase
        .from("contacts")
        .select("id, name, organization")
        .ilike("name", contact_name);

      if (findError) {
        return {
          content: [{ type: "text" as const, text: `Error finding contact: ${findError.message}` }],
          isError: true,
        };
      }

      if (!matches || matches.length === 0) {
        return {
          content: [{ type: "text" as const, text: `No contact found matching "${contact_name}". Create them first with upsert_contact.` }],
          isError: true,
        };
      }

      if (matches.length > 1) {
        const list = matches.map((m: { name: string; organization: string | null }) =>
          `  - ${m.name}${m.organization ? ` (${m.organization})` : ""}`
        ).join("\n");
        return {
          content: [{ type: "text" as const, text: `Multiple contacts match "${contact_name}":\n${list}\n\nPlease use a more specific name.` }],
        };
      }

      const contact = matches[0];
      const interactionTime = occurred_at || new Date().toISOString();

      // Insert interaction
      const { error: insertError } = await supabase
        .from("interactions")
        .insert({
          contact_id: contact.id,
          type: type,
          summary: summary,
          occurred_at: interactionTime,
        });

      if (insertError) {
        return {
          content: [{ type: "text" as const, text: `Error logging interaction: ${insertError.message}` }],
          isError: true,
        };
      }

      // Update contact's last_contact (and optionally followup)
      const contactUpdate: Record<string, unknown> = {
        last_contact: interactionTime,
      };
      if (clear_followup) {
        contactUpdate.next_followup = null;
        contactUpdate.followup_note = null;
      } else if (next_followup) {
        contactUpdate.next_followup = next_followup;
        contactUpdate.followup_note = followup_note || null;
      }

      await supabase
        .from("contacts")
        .update(contactUpdate)
        .eq("id", contact.id);

      let confirmation = `Logged ${type} with ${contact.name}: "${summary}"`;
      if (clear_followup) {
        confirmation += `\nFollow-up cleared.`;
      } else if (next_followup) {
        confirmation += `\nFollow-up set for ${formatDate(next_followup)}`;
        if (followup_note) confirmation += `: ${followup_note}`;
      }

      return {
        content: [{ type: "text" as const, text: confirmation }],
      };
    } catch (err: unknown) {
      return {
        content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "delete_contact",
  {
    title: "Delete Contact",
    description:
      "Delete a contact and all their interactions from the CRM. Use when a contact was created by mistake or is no longer relevant.",
    inputSchema: {
      contact_name: z.string().describe("Name of the contact to delete (case-insensitive match)"),
    },
  },
  async ({ contact_name }) => {
    try {
      const { data: matches, error: findError } = await supabase
        .from("contacts")
        .select("id, name, organization")
        .ilike("name", contact_name);

      if (findError) {
        return {
          content: [{ type: "text" as const, text: `Error finding contact: ${findError.message}` }],
          isError: true,
        };
      }

      if (!matches || matches.length === 0) {
        return {
          content: [{ type: "text" as const, text: `No contact found matching "${contact_name}".` }],
          isError: true,
        };
      }

      if (matches.length > 1) {
        const list = matches.map((m: { name: string; organization: string | null }) =>
          `  - ${m.name}${m.organization ? ` (${m.organization})` : ""}`
        ).join("\n");
        return {
          content: [{ type: "text" as const, text: `Multiple contacts match "${contact_name}":\n${list}\n\nPlease use a more specific name.` }],
        };
      }

      const contact = matches[0];
      const { error: deleteError } = await supabase
        .from("contacts")
        .delete()
        .eq("id", contact.id);

      if (deleteError) {
        return {
          content: [{ type: "text" as const, text: `Error deleting contact: ${deleteError.message}` }],
          isError: true,
        };
      }

      return {
        content: [{ type: "text" as const, text: `Deleted contact: ${contact.name}${contact.organization ? ` (${contact.organization})` : ""}. All interactions have been removed.` }],
      };
    } catch (err: unknown) {
      return {
        content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }],
        isError: true,
      };
    }
  }
);

const app = new Hono();

app.all("*", async (c) => {
  const provided = c.req.header("x-brain-key") || new URL(c.req.url).searchParams.get("key");
  if (!provided || provided !== MCP_ACCESS_KEY) {
    return c.json({ error: "Invalid or missing access key" }, 401);
  }

  const transport = new StreamableHTTPTransport();
  await server.connect(transport);
  return transport.handleRequest(c);
});

Deno.serve(app.fetch);
