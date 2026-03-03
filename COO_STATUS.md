# COO Status — Open Brain

**Last updated:** 2026-03-04
**Stage:** Pre-seed (MVP live)
**Owner:** Dr. Brian 🧠

## Current State
- MVP deployed and operational on Supabase
- 4 MCP tools: capture_thought, search_thoughts, list_thoughts, thought_stats
- Discord #capture channel active for thought ingestion
- Gmail email capture: local pull script (scripts/pull-gmail.ts) — Phase 1 + 2 complete, 153 thoughts ingested (30-day SENT+STARRED)
- Connected clients: Claude Code ✅, Cursor ✅, Claude Desktop ✅, ChatGPT ✅, OpenClaw ✅

## Recent Changes (2026-03-04)
- Phase 1 complete: parent_id/chunk_index schema, insert_thought RPC, search_thoughts chunk dedup
- Phase 2 complete: Gmail pull script with OAuth, multi-label OR logic, quote stripping (incl. multi-line "On ... wrote:"), transactional noise filters, sentence-boundary chunking fallback, gmail_labels in metadata
- Security hardened: INGEST_KEY required (no auth bypass), embedding retry (3 attempts), 8k-char cap for embedding API, OpenRouter error handling
- 30-day scale test: 170 messages, 123 processed, 47 filtered, 153 thoughts ingested, 0 errors (~$0.02, ~8 min)
- Plan updated: .cursor/plans/open_brain_email_capture_75b0a917.plan.md

## Active Work — Email Capture
Spec: .cursor/plans/open_brain_email_capture_75b0a917.plan.md

### Done
- Phase 1: Core pipeline (schema, chunking, dedup in search)
- Phase 2: Gmail pull script (OAuth, labels, windows, chunking, dedup, label metadata)
- Scale test: 30d SENT+STARRED ✅
- Backlog fixes: Lenny/OpenRouter edge cases, 1925-word unchunked email (sentence fallback), retry + content cap

### Next
- Phase 3: Deferred. Decision: keep pulls local (privacy, simplicity); skip MCP tools (pull_emails, email_sync_status) for Nate deliverable.
- Phase 4: Nate B. Jones deliverable — The Story, The Guide, What Changed, reference code

## Blockers
- None

## Migration Log
- 2026-03-02: Migrated from ~/.openclaw/workspace/supabase/ and Halo workspace to dedicated repo
- 2026-03-02: Full alignment with Nate's updated setup guide (DB + functions + docs)
- 2026-03-03: Email capture pipeline built and validated
- 2026-03-04: Phase 1+2 complete, security hardened, 30-day run, plan updated
