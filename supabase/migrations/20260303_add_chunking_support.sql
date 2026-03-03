-- Add chunking support (GitHub Issue #1)
-- parent_id links chunks to their source document
-- chunk_index tracks ordering within a parent

ALTER TABLE thoughts
  ADD COLUMN IF NOT EXISTS parent_id uuid REFERENCES thoughts(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS chunk_index integer;

-- Index for fast lookup of chunks by parent
CREATE INDEX IF NOT EXISTS thoughts_parent_id ON thoughts (parent_id) WHERE parent_id IS NOT NULL;

-- Must drop and recreate because return type is changing
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
  chunk_index integer
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
    t.chunk_index
  FROM thoughts t
  WHERE 1 - (t.embedding <=> query_embedding) > match_threshold
    AND (filter = '{}'::jsonb OR t.metadata @> filter)
  ORDER BY t.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
