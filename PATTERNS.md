# Patterns — Open Brain

## Vector Search
- **Always HNSW, never IVFFlat** for incrementally-growing datasets
- Default similarity threshold: 0.1 (diverse thoughts = low cosine similarity)
- Embedding model: text-embedding-3-small (1536 dims) — good balance of quality/cost

## Auth
- Key-based auth (x-brain-key header or ?key= query param)
- No Supabase JWT — deployed with --no-verify-jwt, function manages its own auth
- Separate keys for MCP server (MCP_ACCESS_KEY) and capture endpoint (INGEST_KEY)

## Deployment
- Always `supabase functions deploy <name> --no-verify-jwt`
- Test with curl after every deploy
- Secrets managed via `supabase secrets set`

## Cross-Project Integration
- Any MonkeyRun project connects via MCP client config
- Cursor: mcp-remote bridge in .cursor/mcp.json
- Claude Code: `claude mcp add` with --transport http
- OpenClaw agents: can curl the ingest endpoint directly
