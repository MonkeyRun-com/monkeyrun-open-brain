# Open Brain Architecture

## Database Schema

### Table: `thoughts`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid (PK, gen_random_uuid) | |
| content | text | Raw thought text |
| embedding | vector(1536) | text-embedding-3-small |
| metadata | jsonb | LLM-extracted (type, topics, people, sentiment, action_items, source) |
| created_at | timestamptz | Default now() |

### Index
- HNSW on `embedding` column using `vector_cosine_ops`
- ⚠️ **Do NOT use IVFFlat** — it requires a large dataset to build good clusters and returns 0 results on small datasets

### RLS
- Enabled. Policy: service_role has full access only.

### SQL Function
```sql
match_thoughts(query_embedding vector, match_threshold float8 DEFAULT 0.5, match_count int DEFAULT 10)
```
Returns matching thoughts by cosine similarity (1 - distance).

## Edge Functions

### `open-brain-mcp` (MCP Server)
- Deno + Hono + @modelcontextprotocol/sdk@1.25.3
- WebStandardStreamableHTTPServerTransport
- 4 tools: save_thought, search_thoughts, recent_thoughts, brain_stats
- Auth: x-brain-key header OR ?key= query param vs MCP_ACCESS_KEY env

### `ingest-thought` (Capture Endpoint)
- Simple POST endpoint for Discord capture channel
- Auth: x-ingest-key header vs INGEST_KEY env
- Generates embedding + extracts metadata in parallel
- Returns: id, type, topics, people, action_items

## Known Issues & Fixes (DON'T RE-INTRODUCE)

1. **IVFFlat index** — Fails silently on small datasets. Always use HNSW.
2. **Similarity threshold** — Default 0.1, not 0.4. Diverse thoughts have low cosine similarity.
3. **JWT verification** — Deploy with --no-verify-jwt. Function handles its own auth.

## Secrets (Supabase)
- OPENROUTER_API_KEY
- MCP_ACCESS_KEY
- INGEST_KEY
