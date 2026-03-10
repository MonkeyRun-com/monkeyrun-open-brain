-- Add phone to match_contacts return type (was stored but not returned)
-- Must DROP first because CREATE OR REPLACE cannot change return type.

DROP FUNCTION IF EXISTS match_contacts(vector(1536), float, int);

CREATE OR REPLACE FUNCTION match_contacts(
  query_embedding vector(1536),
  match_threshold float DEFAULT 0.1,
  match_count int DEFAULT 5
)
RETURNS TABLE (
  id uuid,
  name text,
  email text,
  phone text,
  organization text,
  role text,
  relationship text,
  context text,
  tags text[],
  last_contact timestamptz,
  next_followup timestamptz,
  followup_note text,
  metadata jsonb,
  similarity float,
  created_at timestamptz
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    c.id,
    c.name,
    c.email,
    c.phone,
    c.organization,
    c.role,
    c.relationship,
    c.context,
    c.tags,
    c.last_contact,
    c.next_followup,
    c.followup_note,
    c.metadata,
    1 - (c.embedding <=> query_embedding) AS similarity,
    c.created_at
  FROM contacts c
  WHERE 1 - (c.embedding <=> query_embedding) > match_threshold
  ORDER BY c.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- Rollback:
-- Re-run 20260311_contact_rpc_functions.sql match_contacts section (without phone)
