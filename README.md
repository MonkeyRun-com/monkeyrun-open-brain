# Open Brain 🧠

> **Built on [Nate B. Jones's Open Brain](https://www.natebjones.com) architecture.** This is MonkeyRun's implementation and extension of his open-source personal memory system — we've added Gmail capture, RAG chunking for long-form content, and documented the journey of building it with AI.

**[MonkeyRun](https://monkeyrun.com)** is a software studio that builds and ships products using AI as the primary development partner — using tools like Cursor, Claude, and OpenClaw to manage real projects end-to-end. This repo is one of those experiments: building a persistent AI memory layer and learning in public.

Open Brain is an MCP server that lets AI agents save, search, and retrieve "thoughts" using semantic vector search. You capture ideas, decisions, emails, and notes — and any AI client you use (Claude, ChatGPT, OpenClaw) can search them by meaning, not just keyword.

## Guides & Extensions

| Guide | Description |
|-------|-------------|
| [Email Capture — Visual Overview](https://monkeyrun-com.github.io/monkeyrun-open-brain/email-capture-guide.html) | Add Gmail to your persistent memory — pull-based ingestion, RAG chunking, the five things that broke |
| [Email Capture — Full Guide](docs/EMAIL_CAPTURE_GUIDE.md) | Step-by-step setup, troubleshooting, automation, and security notes |
| [Substack Post Draft](docs/SUBSTACK_POST_DRAFT.md) | Community contribution post for Nate B. Jones's Open Brain series |

## Architecture

- **Database:** Supabase PostgreSQL + pgvector (1536-dimension embeddings)
- **Embeddings:** OpenRouter → `openai/text-embedding-3-small`
- **Metadata extraction:** OpenRouter → `openai/gpt-4o-mini`
- **MCP Server:** Deno Edge Function (Supabase) using `@modelcontextprotocol/sdk`
- **Capture:** Discord #capture channel → `ingest-thought` Edge Function

## MCP Tools

| Tool | Description |
|------|-------------|
| `capture_thought` | Save a thought with auto-embedding + LLM-extracted metadata |
| `search_thoughts` | Semantic search via vector similarity |
| `list_thoughts` | Browse recent thoughts with filters (type, topic, person, days) |
| `thought_stats` | Totals, type distribution, top topics, top people |

## Deployment

```bash
supabase functions deploy open-brain-mcp --no-verify-jwt
supabase functions deploy ingest-thought --no-verify-jwt
```

## Infrastructure

- **Supabase Project:** Your own Supabase project (see `supabase/config.toml` after `supabase link`)
- **Auth:** Custom key-based (x-brain-key header or ?key= query param)
- **JWT:** Disabled at function level (self-managed auth)
