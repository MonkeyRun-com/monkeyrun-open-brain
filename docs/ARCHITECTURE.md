# Open Brain Architecture

## Database Schema

### Table: `thoughts`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid (PK, gen_random_uuid) | |
| content | text | Raw thought text |
| embedding | vector(1536) | text-embedding-3-small |
| metadata | jsonb | LLM-extracted (type, topics, people, sentiment, action_items, dates_mentioned, source) |
| parent_id | uuid (FK -> thoughts.id, nullable) | Self-referential FK. Links chunks to their parent document. CASCADE on delete. |
| chunk_index | integer (nullable) | Ordering of chunk within parent (0-based) |
| created_at | timestamptz | Default now() |
| updated_at | timestamptz | Default now(), auto-updated via trigger |

### Indexes
- HNSW on `embedding` column using `vector_cosine_ops`
- GIN on `metadata` for JSONB containment queries
- B-tree on `created_at DESC` for chronological queries
- B-tree on `parent_id` (partial, WHERE parent_id IS NOT NULL) for chunk lookups
- ⚠️ **Do NOT use IVFFlat** — it requires a large dataset to build good clusters and returns 0 results on small datasets

### RLS
- Enabled. Policy: service_role has full access only.

### SQL Function
```sql
match_thoughts(
  query_embedding vector(1536),
  match_threshold float DEFAULT 0.1,
  match_count int DEFAULT 10,
  filter jsonb DEFAULT '{}'::jsonb
)
```
Returns matching thoughts by cosine similarity (1 - distance).
Supports JSONB containment filtering via `metadata @> filter`.
Now also returns `parent_id` and `chunk_index` for chunk-aware retrieval.

### Chunking Model
- Long content (500+ words) is stored as a parent document + individual chunks
- Parent: full text with its own embedding, `parent_id = NULL`
- Chunks: 200-500 word segments with 50-word overlap, `parent_id` pointing to parent, `chunk_index` for ordering
- `search_thoughts` MCP tool deduplicates: if multiple chunks from the same parent match, only the best-matching chunk is returned with a note about how many sections matched
- `ingest-thought` accepts optional `parent_id` and `chunk_index` fields

## Edge Functions

### `open-brain-mcp` (MCP Server)
- Deno + Hono + @hono/mcp@0.1.1 + @modelcontextprotocol/sdk@1.24.3
- StreamableHTTPTransport (via @hono/mcp)
- 4 tools: capture_thought, search_thoughts, list_thoughts, thought_stats
- Auth: x-brain-key header OR ?key= query param vs MCP_ACCESS_KEY env (required, no bypass)
- Error responses include `isError: true` per MCP spec
- Metadata extraction uses `response_format: { type: "json_object" }` for reliable JSON

### `ingest-thought` (Capture Endpoint)
- POST endpoint for Discord capture channel and Gmail pull script
- Auth: x-ingest-key header vs INGEST_KEY env
- Generates embedding + extracts metadata in parallel
- Uses `response_format: { type: "json_object" }` for reliable JSON
- Accepts optional `parent_id` and `chunk_index` for linked chunks
- Returns: id, type, topics, people, action_items

## Known Issues & Fixes (DON'T RE-INTRODUCE)

1. **IVFFlat index** — Fails silently on small datasets. Always use HNSW.
2. **Similarity threshold** — Default 0.1, not 0.4 or 0.5. Diverse thoughts have low cosine similarity.
3. **JWT verification** — Deploy with --no-verify-jwt. Function handles its own auth.
4. **Auth bypass** — MCP_ACCESS_KEY must be required (`!` not `|| ""`). Never skip auth on empty key.

## Secrets (Supabase)
- OPENROUTER_API_KEY
- MCP_ACCESS_KEY
- INGEST_KEY

## Client Connections
- **Cursor**: mcp-remote bridge in ~/.cursor/mcp.json (global)
- **Claude Code**: `claude mcp add --transport http --header "x-brain-key: ..."`
- **Claude Desktop**: Settings → Connectors → URL with ?key= (no OAuth needed)
- **ChatGPT**: Custom App → No Authentication → URL with ?key=
