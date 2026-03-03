-- Add chunking columns (retry — previous migration partially failed)
ALTER TABLE thoughts
  ADD COLUMN IF NOT EXISTS parent_id uuid REFERENCES thoughts(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS chunk_index integer;

CREATE INDEX IF NOT EXISTS thoughts_parent_id ON thoughts (parent_id) WHERE parent_id IS NOT NULL;

-- Recreate the insert_thought function with the new columns
CREATE OR REPLACE FUNCTION insert_thought(
  p_content text,
  p_embedding vector(1536),
  p_metadata jsonb,
  p_parent_id uuid DEFAULT NULL,
  p_chunk_index integer DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  new_id uuid;
BEGIN
  INSERT INTO thoughts (content, embedding, metadata, parent_id, chunk_index)
  VALUES (p_content, p_embedding, p_metadata, p_parent_id, p_chunk_index)
  RETURNING id INTO new_id;
  RETURN new_id;
END;
$$;

NOTIFY pgrst, 'reload schema';
