# Open Brain: Email Capture
## Adding Gmail to Your Persistent Memory

**An extension to Nate B. Jones's Open Brain setup guide**

Your Open Brain already captures thoughts you type into Slack. This guide adds the second-biggest source of your thinking: email. Specifically, the email you *send* — because what you write to people is some of the clearest thinking you produce all day.

---

## Part 1: The Story

### Why Email?

Nate's guide cracked the daily capture habit. You type a thought into Slack, it gets embedded and classified in five seconds, and any AI you use can search it by meaning. That's genuinely transformative — but it captures what you *decide to capture*.

Your email is different. It's thinking you already did. Every email you write is a decision, a position, a relationship update, or a problem you solved. You wrote it, you sent it, and it immediately became invisible to your AI tools.

When we looked at 30 days of sent mail — Kai's school correspondence, environmental grant applications, angel investing conversations, community council work — it was 153 distinct thoughts that an AI couldn't access until now. Things like: the 1,300-word email explaining Kai's situation to his school team. The grant application narrative for HVCR flood restoration. The strategic advice email about a HubSpot data issue. All of it, in your voice, about the things that actually matter to you.

That's what this extension adds.

### How We Built It (The AI-Assisted Journey)

This pipeline was built in a single session with Dr. Brian — an AI agent running in Cursor, playing the role of knowledge architect for Open Brain. We're sharing the story because it illustrates something important about building with AI: the hard parts aren't where you expect them.

**What we thought would be hard:** Gmail OAuth. Getting permission to read someone's email programmatically requires Google Cloud Console setup, consent screens, scopes, token refresh. It's genuinely involved.

**What was actually hard:** Five things we didn't anticipate.

**1. Gmail's line-wrapping breaks quote detection**

When you reply to an email, Gmail includes the original message prefixed with "On Mon, Mar 2, 2026 at 8:56 AM Lenny's Newsletter wrote:" — but that text wraps across 2-3 lines in plain text format. Our first attempt at stripping quoted replies only matched the whole thing on one line. Result: Lenny's Newsletter reply contained 700 words of newsletter content that looked like original writing. We caught this because one email showed 703 words when the reply was literally "hello." Fix: look ahead across multiple lines to detect the split pattern.

**2. Supabase's PostgREST cache doesn't update instantly**

We added two new columns to the database — `parent_id` and `chunk_index` — to support linking email chunks to their parent document. The SQL ran fine. But the REST API that Edge Functions use to talk to Postgres didn't see the new columns. At all. We tried reloading the schema cache four different ways. None worked reliably. The fix was to create an RPC function (`insert_thought`) that bypasses the REST API entirely and writes directly via PL/pgSQL. Lesson for anyone building on hosted Supabase: if you add columns and your Edge Function can't see them, create an RPC function rather than fighting the cache.

**3. A Costco Travel booking confirmation produced 23 chunks of CSS**

When we added the STARRED label to pull inbound emails, the first starred email processed was a Costco Travel booking confirmation. It was 8,874 words — almost entirely CSS and HTML boilerplate, chunked into 23 meaningless fragments. The Gmail API returns the HTML version of many emails, and our HTML-to-text conversion preserved too much structure. Fix: detect CSS density (more than 10 `{...}` blocks) and skip the email, plus filter sender patterns like `no-reply`, `noreply`, `automated@`, and subject patterns like "booking confirmation," "payment due," "your receipt."

**4. The Gmail label API is AND, not OR**

If you pass `labelIds=SENT&labelIds=STARRED` to the Gmail API, it returns messages that have *both* labels — not messages that have *either*. This is the opposite of what most people want. We needed OR logic: sent emails plus starred emails as separate pools. Fix: query each label independently and deduplicate by message ID before processing.

**5. A 1,900-word email wouldn't chunk**

Our chunking logic splits emails that exceed 500 words into 200-500 word segments, using paragraph breaks as the split points. One 1,900-word email came through as a single thought anyway. The reason: it had no double-newline paragraph breaks — just one continuous wall of text. When there are no paragraph boundaries to split on, the paragraph-first approach produces a single oversized "chunk" and stops. Fix: detect when paragraph splitting produces only one segment and fall back to sentence-boundary splitting instead.

**The number that matters:** 30 days of email, SENT + STARRED labels. 170 messages fetched. 47 filtered as noise (transactional, auto-generated, CSS-heavy). 123 processed. 153 thoughts ingested, including 13 emails chunked into smaller segments with proper parent-child linking. Total API cost: $0.02. Total time: 8 minutes.

---

## Part 2: The Guide

### What You're Building

A local script that connects to your Gmail, pulls emails from your chosen labels and time window, cleans and chunks the content, and ingests it into your Open Brain database. The same database, the same MCP server, the same AI tools — your email just becomes searchable alongside everything else you've captured.

### What You Need

- Your Open Brain already set up and running (from Nate's guide)
- [Deno](https://deno.com) installed — `brew install deno` on Mac, or `winget install DenoLand.Deno` on Windows
- A Google account with Gmail
- About 30 minutes for the first run

### Credential Tracker

You'll generate one new set of credentials. Add these to your existing credential tracker:

```
GMAIL (Step 2)
  Google Cloud Project:   ____________
  OAuth Client ID:        ____________
  OAuth Client Secret:    ____________
  credentials.json saved: yes / no
```

---

### Step 1: Get the Code

If you haven't already, clone the Open Brain repository (or download the scripts folder):

```bash
git clone https://github.com/MonkeyRun-com/monkeyrun-open-brain.git
cd monkeyrun-open-brain
```

If you already have the repo, pull the latest:

```bash
cd monkeyrun-open-brain
git pull
```

---

### Step 2: Create Google Cloud OAuth Credentials

This is the most involved step. Take it slowly — the screenshots below describe what to look for.

**2a. Create a Google Cloud Project**

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Click the project selector at the top (it may say "Select a project")
3. Click **New Project**
4. Name it "Open Brain" — click **Create**
5. Make sure your new project is selected in the project selector

**2b. Enable the Gmail API**

1. Go to [APIs & Services > Library](https://console.cloud.google.com/apis/library)
2. Search for "Gmail API"
3. Click **Gmail API** → click **Enable**

**2c. Configure the OAuth Consent Screen**

1. Go to [APIs & Services > OAuth consent screen](https://console.cloud.google.com/apis/credentials/consent)
2. Choose **External** → click **Create**
3. Fill in:
   - App name: `Open Brain`
   - User support email: your Gmail address
   - Developer contact email: your Gmail address
4. Click **Save and Continue**
5. On the Scopes page, click **Add or Remove Scopes**
6. Search for `gmail.readonly` → check it → click **Update** → **Save and Continue**
7. On the Test Users page, click **Add Users** → enter your Gmail address → **Save and Continue**
8. Click **Back to Dashboard**

**2d. Create the OAuth Client ID**

1. Go to [APIs & Services > Credentials](https://console.cloud.google.com/apis/credentials)
2. Click **Create Credentials** → **OAuth client ID**
3. Application type: **Desktop app**
4. Name: `Open Brain`
5. Click **Create**
6. Click **Download JSON** on the confirmation dialog
7. Save the downloaded file as `scripts/credentials.json` in your Open Brain folder

Your `scripts/` folder should now have: `credentials.json`

---

### Step 3: Update Your Database

Your existing Open Brain database needs two new columns to support email chunking — `parent_id` (links chunks to their parent email) and `chunk_index` (orders the chunks).

**3a. Open your Supabase project**

Go to [supabase.com/dashboard](https://supabase.com/dashboard), open your project.

**3b. Open the SQL Editor**

Click **SQL Editor** in the left sidebar.

**3c. Run this migration**

Paste the following and click **Run**:

```sql
-- Add chunking support to thoughts table
ALTER TABLE thoughts
  ADD COLUMN IF NOT EXISTS parent_id uuid REFERENCES thoughts(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS chunk_index integer;

CREATE INDEX IF NOT EXISTS thoughts_parent_id ON thoughts (parent_id)
  WHERE parent_id IS NOT NULL;

-- Function to insert thoughts (bypasses PostgREST schema cache)
CREATE OR REPLACE FUNCTION insert_thought(
  p_content text,
  p_embedding vector(1536),
  p_metadata jsonb,
  p_parent_id uuid DEFAULT NULL,
  p_chunk_index integer DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE new_id uuid;
BEGIN
  INSERT INTO thoughts (content, embedding, metadata, parent_id, chunk_index)
  VALUES (p_content, p_embedding, p_metadata, p_parent_id, p_chunk_index)
  RETURNING id INTO new_id;
  RETURN new_id;
END;
$$;
```

You should see "Success. No rows returned."

---

### Step 4: Deploy the Updated Edge Functions

Your `ingest-thought` and `open-brain-mcp` functions have been updated. Deploy them with:

```bash
supabase functions deploy ingest-thought --no-verify-jwt
supabase functions deploy open-brain-mcp --no-verify-jwt
```

If you don't have the Supabase CLI, install it first:

```bash
brew install supabase/tap/supabase
supabase login
```

---

### Step 5: Set Your Environment Variables

For live ingestion, the script needs your endpoint URL and key. Set these in your terminal session:

```bash
export INGEST_URL="https://YOUR_PROJECT_REF.supabase.co/functions/v1/ingest-thought"
export INGEST_KEY="your-ingest-key"
```

Replace `YOUR_PROJECT_REF` with your Supabase project reference (the string in your project URL), and `your-ingest-key` with the `INGEST_KEY` you set when building the original system.

To avoid setting these every time, add them to your shell profile (`~/.zshrc` or `~/.bashrc`):

```bash
echo 'export INGEST_URL="https://YOUR_PROJECT_REF.supabase.co/functions/v1/ingest-thought"' >> ~/.zshrc
echo 'export INGEST_KEY="your-ingest-key"' >> ~/.zshrc
source ~/.zshrc
```

---

### Step 6: First Run (Dry Run — No Ingestion)

Run this from your Open Brain folder. It will open a Google authorization URL in your terminal — copy it into your browser and authorize.

```bash
deno run --allow-net --allow-read --allow-write --allow-env \
  scripts/pull-gmail.ts --dry-run --window=24h
```

**What happens:**

1. The script prints a URL — open it in your browser
2. Authorize with your Google account (the consent screen you set up)
3. The browser redirects to `localhost:3847` — the script catches it automatically
4. Your token is saved to `scripts/token.json` for future runs (no re-auth needed)
5. The script shows you what the last 24 hours of your sent mail would look like if ingested

Look at the output. You'll see each email with its word count and a preview of the first 120 characters. This is your chance to see what's in the pipeline before anything is stored.

**Things to check:**

- Are there obviously junk emails showing up? (auto-generated messages, Gmail notifications)
- Does the content preview look right? (not truncated mid-sentence, not full of HTML)
- Are long emails showing `[N chunks]`? That means they'll be split for better retrieval.

---

### Step 7: First Live Run

When the dry run looks good, run it for real:

```bash
deno run --allow-net --allow-read --allow-write --allow-env \
  scripts/pull-gmail.ts --window=24h
```

The script will show you each email as it's ingested, along with the type and topics the AI extracted. At the end, you'll see a summary with total thoughts ingested and an estimated API cost.

**If you see errors:** The most common issue is an incorrect `INGEST_KEY`. Double-check it matches what you set in Supabase secrets (`supabase secrets list`).

---

### Step 8: Scale Up

Now that the first run works, go further:

```bash
# Last 7 days of sent mail
deno run --allow-net --allow-read --allow-write --allow-env \
  scripts/pull-gmail.ts --window=7d

# Last 30 days of sent mail plus starred emails
deno run --allow-net --allow-read --allow-write --allow-env \
  scripts/pull-gmail.ts --window=30d --labels=SENT,STARRED

# See all your Gmail labels to find custom ones
deno run --allow-net --allow-read --allow-write --allow-env \
  scripts/pull-gmail.ts --list-labels
```

**Re-running is safe.** The script tracks which emails it has already ingested in `scripts/sync-log.json`. Running `--window=30d` twice only processes new emails the second time.

---

### Label Strategy

| Label | What it contains | Recommendation |
|-------|-----------------|----------------|
| `SENT` | Everything you sent | Always include — highest signal |
| `STARRED` | Emails you explicitly starred | Good for capturing important inbound |
| `IMPORTANT` | Gmail's auto-importance marking | More noise than SENT, less than INBOX |
| `INBOX` | Everything in your inbox | Very high noise — not recommended |
| `CATEGORY_PROMOTIONS` | Marketing emails | Skip entirely |
| Custom labels | Your own organization | Gold — add any that represent meaningful categories |

**Best starting point:** `--labels=SENT,STARRED`

**Pro tip:** If you use Gmail labels to organize your life (project labels, client labels, topic labels), those become searchable metadata in your brain. The script stores all Gmail labels on each ingested thought, so you can later filter: "show me all thoughts tagged with my 'p_AngelVC' label."

---

### Cost Estimates

| Window | Typical volume | Estimated cost |
|--------|---------------|----------------|
| 24 hours | 5–20 emails | ~$0.002 |
| 7 days | 30–80 emails | ~$0.01 |
| 30 days | 100–200 emails | ~$0.02 |
| 1 year | 1,000–2,000 emails | ~$0.20 |

Costs are for embedding + metadata extraction via OpenRouter. Long emails that get chunked count as multiple thoughts.

---

### Checking Your Email Sync

From any connected AI client (Claude, ChatGPT, OpenClaw), you can now ask:

> "What's my email sync status?"

The new `email_sync_status` tool will show you the total count of email-sourced thoughts, the date range covered, and a breakdown by Gmail label.

---

## Part 3: What Changed (For Existing Open Brain Users)

If you already have Open Brain running from Nate's original guide, here's exactly what's new.

### Database Changes

Two new optional columns on the `thoughts` table:

| Column | Type | Purpose |
|--------|------|---------|
| `parent_id` | `uuid` (nullable FK) | Links chunks to their parent document |
| `chunk_index` | `integer` (nullable) | Orders chunks within a parent (0-based) |

These are nullable — your existing thoughts are unaffected.

New index: `thoughts_parent_id` (partial, only rows where `parent_id IS NOT NULL`) for fast chunk lookups.

New SQL function: `insert_thought` — used internally by the Edge Function to bypass PostgREST's schema cache.

**Run the migration from Part 2, Step 3.** It uses `IF NOT EXISTS` so it's safe to run more than once.

### Updated Edge Functions

**`ingest-thought`** now:
- Accepts optional `parent_id` and `chunk_index` in the request body (for linked chunk storage)
- Accepts optional `extra_metadata` (used to pass Gmail labels and message IDs)
- Has embedding retry logic (3 attempts with backoff) for transient OpenRouter failures
- Caps embedding input at 8,000 characters (prevents failures on content-heavy emails)
- Uses `!` on `INGEST_KEY` — if the key is unset, the function crashes on startup rather than silently accepting all requests

**`open-brain-mcp`** now:
- `search_thoughts` fetches 3x the requested limit and deduplicates chunks from the same parent email — if 3 chunks of a long email match your query, you get one result with a note saying "3 sections of this document matched"
- New tool: `email_sync_status` — returns ingestion counts, date range, and label breakdown

**Redeploy both functions after running the migration:**

```bash
supabase functions deploy ingest-thought --no-verify-jwt
supabase functions deploy open-brain-mcp --no-verify-jwt
```

### New Files

| File | Purpose |
|------|---------|
| `scripts/pull-gmail.ts` | The Gmail pull script |
| `scripts/SETUP.md` | Quick reference for script options |
| `scripts/credentials.json` | Your Google OAuth credentials (gitignored, you create this) |
| `scripts/token.json` | Your OAuth access token (gitignored, auto-created on first run) |
| `scripts/sync-log.json` | Tracks ingested Gmail message IDs (gitignored, auto-created) |

### Metadata Schema Addition

Email-sourced thoughts include additional fields in their `metadata` JSONB:

```json
{
  "type": "observation",
  "topics": ["education", "school"],
  "people": ["Kate", "Kai"],
  "sentiment": "positive",
  "source": "gmail",
  "gmail_labels": ["SENT", "IMPORTANT"],
  "gmail_id": "18e4f2a...",
  "gmail_thread_id": "18e4f1..."
}
```

The `gmail_labels` array contains human-readable label names (not Gmail's internal IDs).

---

## Part 4: Reference

### Script Options

```
deno run --allow-net --allow-read --allow-write --allow-env scripts/pull-gmail.ts [options]
```

| Flag | Default | Description |
|------|---------|-------------|
| `--window=` | `24h` | Time window: `24h`, `7d`, `30d`, `1y`, `all` |
| `--labels=` | `SENT` | Comma-separated Gmail labels (OR logic) |
| `--dry-run` | off | Show what would be ingested without ingesting |
| `--limit=` | `50` | Max emails to process per run |
| `--list-labels` | off | Print all Gmail labels and exit |

### Troubleshooting

**"Unauthorized" error on ingestion**
Your `INGEST_KEY` environment variable doesn't match the one stored in Supabase. Check with `supabase secrets list` and re-export the correct value.

**"Module not found" error**
You need to run the script from your Open Brain project directory:
```bash
cd /path/to/monkeyrun-open-brain
deno run --allow-net --allow-read --allow-write --allow-env scripts/pull-gmail.ts --dry-run
```

**"Token refresh failed"**
Your OAuth token has expired or been revoked. Delete `scripts/token.json` and run the script again to re-authorize.

**Emails showing up that should be filtered**
Run with `--dry-run` to inspect the content. The script filters common noise patterns (transactional senders, booking confirmations, CSS-heavy content) but your inbox may have patterns not covered. You can add custom filter patterns to the `isAutoGenerated` function in `pull-gmail.ts`.

**"No successful provider responses" from OpenRouter**
This is an intermittent OpenRouter issue, usually on emails with very long or unusual content. The script retries 3 times automatically. If it persists, the email is skipped and won't be re-attempted until you delete its entry from `scripts/sync-log.json`.

**Found 0 messages**
Check your labels — `--labels=SENT` is case-sensitive. Run `--list-labels` to see exactly what labels your account has.

### Keeping Your Brain Up to Date

The script doesn't run automatically — you run it when you want to sync. A few patterns that work well:

**Weekly manual sync** (simplest):
```bash
deno run --allow-net --allow-read --allow-write --allow-env \
  scripts/pull-gmail.ts --window=7d --labels=SENT,STARRED
```

**Monthly deep sync** (for new users catching up):
```bash
deno run --allow-net --allow-read --allow-write --allow-env \
  scripts/pull-gmail.ts --window=30d --labels=SENT,STARRED --limit=200
```

**Scheduled via cron** (Mac, runs every Monday at 9am):
```bash
# Add to crontab: crontab -e
0 9 * * 1 cd /path/to/monkeyrun-open-brain && \
  INGEST_URL="..." INGEST_KEY="..." \
  deno run --allow-net --allow-read --allow-write --allow-env \
  scripts/pull-gmail.ts --window=7d --labels=SENT,STARRED
```

The sync log handles deduplication — running the same window twice doesn't create duplicate thoughts.

---

## Acknowledgment

This extension was built on top of Nate B. Jones's Open Brain architecture — the database schema, the embedding pipeline, the MCP server pattern, and the philosophy that your AI memory should be infrastructure you own, not a SaaS dependency. If you haven't read his original guide and post, start there.

The email capture pipeline was built in a single session using AI-assisted development (Cursor + Claude), with Dr. Brian as the project agent. The story of what broke and why is documented in Part 1 — not because it's polished, but because the messy parts are where the learning is.

All code is in the [monkeyrun-open-brain repository](https://github.com/MonkeyRun-com/monkeyrun-open-brain).
