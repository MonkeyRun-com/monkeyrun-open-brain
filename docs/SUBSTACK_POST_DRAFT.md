# Substack Post Draft
## For submission to Nate B. Jones

---

**Suggested title:** I Added Email to Your Open Brain (Here's What Broke)

**Suggested subtitle:** A community extension that adds Gmail pull, RAG chunking, and 30 days of your best thinking — in one session.

---

*[Note for Nate: This is a community contribution built on top of your Open Brain architecture and setup guide. Feel free to edit the voice, add your framing, or publish as-is. All code is in the repo linked below. Happy to answer any questions before you share it.]*

---

Your Open Brain captures what you decide to capture.

That's the right design. Low noise, high signal, fully intentional. But there's a second category of thinking that never makes it in: the email you already wrote.

Every email you send is a decision, a position, an explanation, or a problem solved. You wrote it, you sent it, and it immediately became invisible to your AI tools. Thirty days of sent mail — project updates, strategic advice, client context, personal advocacy — sitting in a folder your brain can't reach.

I built an extension to fix that. It's a local script that connects to your Gmail, pulls emails from labels you configure, cleans and chunks the content, and ingests it into the same Open Brain database you already have. Same MCP server, same AI clients, same search — your email just shows up alongside everything else.

**The result from my first 30-day run:** 170 emails fetched, 47 filtered as noise, 123 processed, 153 thoughts ingested. Total API cost: $0.02. Total time: 8 minutes.

---

## What's different about this vs. your original guide

Your guide is push-based: you decide what to capture and push it in. This is pull-based: the script reaches out to where your thinking already lives and brings it in on your schedule. You're not replacing the push workflow — you're adding a parallel track that captures the thinking you already did but never intentionally archived.

There's also something new under the hood: **chunking**. Long emails are actually bad for semantic search. If you embed a 1,500-word email as a single vector, that vector becomes a blurry average of a dozen topics and matches poorly with any specific query. The fix: split it into 300-word segments, each embedded separately with its own focused meaning. When you search, you get the relevant *section* of the email, not a low-confidence match on the whole thing. This is RAG applied to long-form content — and it required database schema changes, updated Edge Functions, and smarter search logic.

Fair warning: **this requires more setup than your guide did.** Google Cloud OAuth credentials, a consent screen, schema migrations, Supabase CLI, environment variables. Budget an hour, not ten minutes. We documented every failure mode we hit so you don't have to hit them too.

---

## The five things we didn't expect

This was built in a single session with an AI agent (Dr. Brian, running in Cursor). We're sharing the story because the hard parts weren't where we thought they'd be.

**Gmail's quote detection is broken by line-wrapping.** When Gmail wraps "On Mon, Mar 2 at 8:56 AM Someone wrote:" across three lines, a naive stripper misses it. One "reply" came in as 703 words when the actual reply was "hello." Fix: look ahead across multiple lines.

**Supabase's PostgREST cache doesn't see new columns immediately.** We added `parent_id` and `chunk_index` to the database. The SQL ran fine. The Edge Function couldn't see them — at all — for hours. Tried reloading the schema cache four ways. Nothing worked reliably. Fix: create an RPC function that writes directly via PL/pgSQL, bypassing the REST layer entirely.

**A travel booking confirmation produced 23 chunks of CSS.** The Gmail API returns HTML. Our HTML-to-text conversion preserved too much structure. One booking confirmation was 8,874 words of boilerplate, chunked into 23 meaningless fragments. Fix: detect CSS density and skip, plus filter sender patterns like `no-reply` and subject patterns like "your receipt."

**The Gmail label API is AND, not OR.** Passing `SENT` and `STARRED` together returns emails that have *both* labels. We needed either. Fix: query each label independently and deduplicate by message ID.

**A 1,900-word email wouldn't chunk.** One email had no paragraph breaks — just a wall of text. Paragraph-first splitting produced a single oversized chunk and stopped. Fix: detect when paragraph splitting fails and fall back to sentence-boundary splitting.

---

## What it looks like when it works

From any AI client connected to your Open Brain — Claude, ChatGPT, OpenClaw — you can now ask:

> "What have I said about [topic] in email?"
> "Show me the strategic thinking I've written about [project]."
> "What's my email sync status?"

That last one is a new MCP tool (`email_sync_status`) that returns your ingestion count, date range, and a breakdown by Gmail label.

The search deduplication also works the way you'd want: if a long email has three chunks that match your query, you get one result with a note saying "3 sections of this document matched" — not three separate results from the same email.

---

## Security note (don't skip this)

This pulls real email content into your AI memory. That means prompt injection is a real consideration: a crafted email could contain text designed to manipulate your AI when it retrieves and reasons about that content. 

The mitigations: the `SENT` label is lower risk because you wrote those emails. The OAuth scope is read-only (`gmail.readonly`) — nothing can send on your behalf. The metadata extraction step acts as a summarization barrier for ingestion-time attacks. The guide covers this in detail, including what to watch for.

---

## How to get it

Everything is in the **[monkeyrun-open-brain repository](https://github.com/MonkeyRun-com/monkeyrun-open-brain)** — the script, the migration SQL, the updated Edge Functions, and the full guide.

The guide itself is at **`docs/EMAIL_CAPTURE_GUIDE.md`** in the repo. It's structured in four parts:

- **Part 1: The Story** — the AI-assisted journey, including every failure and fix
- **Part 2: The Guide** — step-by-step setup matching the style of your original guide
- **Part 3: What Changed** — the technical changelog for existing Open Brain users
- **Part 4: Reference** — script options, troubleshooting, automation approaches (including OpenClaw), and what's on the roadmap

If you're already running Open Brain, the migration is two SQL statements with `IF NOT EXISTS` — safe to run against a live database.

---

## What's next

Email was the first pull-based source. The same architecture handles others without changes to the database or MCP server: Google Calendar (same OAuth, low effort), meeting transcripts via Fathom or Otter (webhook directly to `ingest-thought`), URL/article ingestion. All on the roadmap.

The cleanest long-term automation is OpenClaw — you can give it a one-line prompt to run the email sync on a weekly schedule and notify you via Telegram when it's done. The guide includes the exact prompt.

---

*Built as a thank-you for your original guide, which made all of this possible. If you implement it and hit something not in the troubleshooting section, open an issue in the repo.*
