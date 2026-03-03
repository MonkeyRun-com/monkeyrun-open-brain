# COO Status — Open Brain

**Last updated:** 2026-03-03
**Stage:** Pre-seed (MVP live)
**Owner:** Dr. Brian 🧠

## Current State
- MVP deployed and operational on Supabase
- 4 MCP tools: capture_thought, search_thoughts, list_thoughts, thought_stats
- Discord #capture channel active for thought ingestion
- Gmail email capture: local pull script proven and working (scripts/pull-gmail.ts)
- Connected clients: Claude Code ✅, Cursor ✅, Claude Desktop ✅, ChatGPT ✅, OpenClaw ✅

## Recent Changes (2026-03-03)
- Built Gmail pull script (scripts/pull-gmail.ts) — full pipeline: OAuth, fetch, parse, chunk, ingest
- Email filtering: auto-generated junk, min 10 words, signature/quoted reply stripping
- Chunking logic: 500-word threshold, 200-500 word chunks, 50-word overlap at paragraph boundaries
- Multi-label OR logic (query per label, deduplicate by message ID)
- Dedup via local sync-log.json — tracks ingested Gmail message IDs, prevents re-ingestion
- Tested: 24h (12 emails ingested) + 7d (29 new emails ingested) = 41 email-sourced thoughts
- Verified retrieval from both Claude Desktop and OpenClaw
- Updated INGEST_KEY (old one was lost, new one generated and set)

## Active Work — Email Capture (GitHub Issue #1 adjacent)
Spec: .cursor/plans/email_capture_strategy_4fb89225.plan.md

### Done
- Phase 2 local script: Gmail API pull with OAuth, configurable labels/windows, chunking, dedup
- Tested incrementally: 24h ✅, 7d ✅

### Next (pick up here)
- Scale test: --window=30d, then --window=1y
- Multi-label test: --labels=SENT,STARRED (OR logic now works)
- Phase 1 schema: parent_id + chunk_index columns (Issue #1) so chunked emails link properly in DB
- Harden ingest-thought error handling (Lenny's Newsletter edge case — OpenRouter returned unexpected response)
- Phase 3: MCP tools (pull_emails, email_sync_status) so AI clients can trigger pulls
- Phase 4: Nate B. Jones deliverable — guide content in his style

## Blockers
- None

## Migration Log
- 2026-03-02: Migrated from `~/.openclaw/workspace/supabase/` and Halo workspace to dedicated repo
- 2026-03-02: Full alignment with Nate's updated setup guide (DB + functions + docs)
- 2026-03-03: Email capture pipeline built and validated
