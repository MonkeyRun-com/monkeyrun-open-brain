# Patterns — Open Brain

## Vector Search
- **Always HNSW, never IVFFlat** for incrementally-growing datasets
- Default similarity threshold: 0.1 (diverse thoughts = low cosine similarity)
- Embedding model: text-embedding-3-small (1536 dims) — good balance of quality/cost
- match_thoughts supports JSONB containment filter param

## Metadata Extraction
- Use `response_format: { type: "json_object" }` — prevents malformed JSON from gpt-4o-mini
- Fields: type, topics, people, action_items, dates_mentioned, sentiment
- Fallback on parse failure: `{ type: "observation", topics: ["uncategorized"] }`

## Auth
- Key-based auth (x-brain-key header or ?key= query param)
- No Supabase JWT — deployed with --no-verify-jwt, function manages its own auth
- MCP_ACCESS_KEY is required — never fall through on empty key
- Separate keys for MCP server (MCP_ACCESS_KEY) and capture endpoint (INGEST_KEY)

## Deployment
- Always `supabase functions deploy <name> --no-verify-jwt`
- Test with curl after every deploy
- Secrets managed via `supabase secrets set`

## MCP Tools
- `capture_thought` — save a thought with auto-embedding + metadata
- `search_thoughts` — semantic vector search with threshold + filter
- `list_thoughts` — browse recent with filters: type, topic, person, days
- `thought_stats` — totals, type distribution, top topics, top people

## Cross-Project Integration
- Any MonkeyRun project connects via MCP client config
- Cursor: mcp-remote bridge in ~/.cursor/mcp.json (global)
- Claude Code: `claude mcp add` with --transport http + --header
- Claude Desktop: Settings → Connectors → URL with ?key=
- ChatGPT: Custom App → No Authentication → URL with ?key=
