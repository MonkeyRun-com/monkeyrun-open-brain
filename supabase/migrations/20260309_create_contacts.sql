-- Contact CRM layer (GitHub Issue #5)
-- contacts table with vector embedding for semantic search

CREATE TABLE contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  organization TEXT,
  role TEXT,
  relationship TEXT,    -- advisor, investor, founder, medical, family, friend, colleague, client
  context TEXT,         -- free-form: how we know them, notes
  tags TEXT[] DEFAULT '{}',
  last_contact TIMESTAMPTZ,
  next_followup TIMESTAMPTZ,
  followup_note TEXT,
  source_ref JSONB DEFAULT '{}',
  metadata JSONB DEFAULT '{}',
  embedding vector(1536),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- HNSW index for semantic search (never IVFFlat)
CREATE INDEX contacts_embedding_hnsw ON contacts
  USING hnsw (embedding vector_cosine_ops);

-- GIN indexes for filtering
CREATE INDEX contacts_tags_gin ON contacts USING gin (tags);
CREATE INDEX contacts_metadata_gin ON contacts USING gin (metadata);

-- B-tree indexes for common queries
CREATE INDEX contacts_organization_idx ON contacts (organization);
CREATE INDEX contacts_relationship_idx ON contacts (relationship);
CREATE INDEX contacts_next_followup_idx ON contacts (next_followup);
CREATE INDEX contacts_created_at_desc ON contacts (created_at DESC);

-- Unique constraint on lowercase email (prevents duplicates)
CREATE UNIQUE INDEX contacts_email_unique ON contacts (lower(email)) WHERE email IS NOT NULL;

-- RLS: enabled but service_role bypasses it (same as thoughts pattern)
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;

-- Reuse existing update_updated_at() trigger function from 20260302
CREATE TRIGGER contacts_updated_at
  BEFORE UPDATE ON contacts
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- Rollback:
-- DROP TABLE IF EXISTS contacts CASCADE;
