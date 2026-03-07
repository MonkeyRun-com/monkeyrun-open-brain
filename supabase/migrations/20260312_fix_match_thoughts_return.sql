-- Fix match_thoughts to return full_text (bonus fix for Issue #5)
-- index.ts references t.full_text but match_thoughts didn't return it

DROP FUNCTION IF EXISTS match_thoughts(vector(1536), float, int, jsonb);

CREATE FUNCTION match_thoughts(
  query_embedding vector(1536),
  match_threshold float DEFAULT 0.1,
  match_count int DEFAULT 10,
  filter jsonb DEFAULT '{}'::jsonb
)
RETURNS TABLE (
  id uuid,
  content text,
  metadata jsonb,
  similarity float,
  created_at timestamptz,
  parent_id uuid,
  chunk_index integer,
  full_text text
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    t.id,
    t.content,
    t.metadata,
    1 - (t.embedding <=> query_embedding) AS similarity,
    t.created_at,
    t.parent_id,
    t.chunk_index,
    t.full_text
  FROM thoughts t
  WHERE 1 - (t.embedding <=> query_embedding) > match_threshold
    AND (filter = '{}'::jsonb OR t.metadata @> filter)
  ORDER BY t.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- Rollback:
-- Revert to previous version without full_text column in return type
