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
| `save_thought` | Store a thought with auto-embedding + LLM-extracted metadata |
| `search_thoughts` | Semantic search via vector similarity |
| `recent_thoughts` | Browse latest N thoughts chronologically |
| `brain_stats` | Thought count, type distribution, top people |

## Deployment

```bash
supabase functions deploy open-brain-mcp --no-verify-jwt
supabase functions deploy ingest-thought --no-verify-jwt
```

## Infrastructure

- **Supabase Project:** MonkeyRunOpenBrain (ref: piigyjxxzrivwvupefsc, region: us-west-2 Oregon)
- **Auth:** Custom key-based (x-brain-key header or ?key= query param)
- **JWT:** Disabled at function level (self-managed auth)
