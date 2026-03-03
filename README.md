# Open Brain 🧠

Personal knowledge/memory layer for MonkeyRun — an MCP server that lets AI agents save, search, and retrieve "thoughts" using semantic vector search.

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
