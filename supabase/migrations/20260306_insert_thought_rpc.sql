-- RPC function for inserting thoughts with all columns
-- Bypasses PostgREST schema cache issues for new columns
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
