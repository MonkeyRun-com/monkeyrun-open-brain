-- Interactions table for contact CRM (GitHub Issue #5)
-- Structured CRM events: who, when, what type

CREATE TABLE interactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  type TEXT NOT NULL DEFAULT 'note',  -- meeting, call, email, coffee, event, note
  summary TEXT NOT NULL,
  source_ref JSONB DEFAULT '{}',
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- B-tree indexes for common queries
CREATE INDEX interactions_contact_occurred ON interactions (contact_id, occurred_at DESC);
CREATE INDEX interactions_occurred_at_desc ON interactions (occurred_at DESC);

-- RLS: enabled but service_role bypasses it
ALTER TABLE interactions ENABLE ROW LEVEL SECURITY;

-- Rollback:
-- DROP TABLE IF EXISTS interactions CASCADE;
