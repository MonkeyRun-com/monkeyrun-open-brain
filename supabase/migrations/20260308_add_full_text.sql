-- Add full_text column for storing original source content alongside the summary
ALTER TABLE thoughts ADD COLUMN IF NOT EXISTS full_text TEXT;

-- Index for full-text search (useful for future keyword search on originals)
CREATE INDEX IF NOT EXISTS idx_thoughts_full_text ON thoughts USING GIN (to_tsvector('english', COALESCE(full_text, '')));

-- Update insert_thought RPC to accept full_text
CREATE OR REPLACE FUNCTION insert_thought(
  p_content TEXT,
  p_embedding vector(1536),
  p_metadata JSONB DEFAULT '{}'::JSONB,
  p_parent_id UUID DEFAULT NULL,
  p_chunk_index INTEGER DEFAULT NULL,
  p_full_text TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO thoughts (content, embedding, metadata, parent_id, chunk_index, full_text)
  VALUES (p_content, p_embedding, p_metadata, p_parent_id, p_chunk_index, p_full_text)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
