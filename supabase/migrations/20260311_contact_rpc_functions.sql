-- RPC functions for contact CRM (GitHub Issue #5)

-- match_contacts: semantic search (mirrors match_thoughts)
CREATE OR REPLACE FUNCTION match_contacts(
  query_embedding vector(1536),
  match_threshold float DEFAULT 0.1,
  match_count int DEFAULT 5
)
RETURNS TABLE (
  id uuid,
  name text,
  email text,
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

-- upsert_contact: create or update with merge logic
-- Match priority: (1) exact email, (2) name+org ILIKE, (3) name-only if exactly 1 match
-- On update: COALESCE non-null fields, append context, union tags, GREATEST last_contact
CREATE OR REPLACE FUNCTION upsert_contact(
  p_name text,
  p_email text DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_organization text DEFAULT NULL,
  p_role text DEFAULT NULL,
  p_relationship text DEFAULT NULL,
  p_context text DEFAULT NULL,
  p_tags text[] DEFAULT '{}',
  p_last_contact timestamptz DEFAULT NULL,
  p_next_followup timestamptz DEFAULT NULL,
  p_followup_note text DEFAULT NULL,
  p_source_ref jsonb DEFAULT '{}'::jsonb,
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_embedding vector(1536) DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_match_id uuid;
  v_matched_on text;
  v_name_matches int;
  v_match_names jsonb;
BEGIN
  -- Priority 1: exact email match
  IF p_email IS NOT NULL THEN
    SELECT c.id INTO v_match_id
    FROM contacts c
    WHERE lower(c.email) = lower(p_email)
    LIMIT 1;

    IF v_match_id IS NOT NULL THEN
      v_matched_on := 'email';
    END IF;
  END IF;

  -- Priority 2: name + org ILIKE match
  IF v_match_id IS NULL AND p_organization IS NOT NULL THEN
    SELECT c.id INTO v_match_id
    FROM contacts c
    WHERE c.name ILIKE p_name
      AND c.organization ILIKE p_organization
    LIMIT 1;

    IF v_match_id IS NOT NULL THEN
      v_matched_on := 'name_org';
    END IF;
  END IF;

  -- Priority 3: name-only if exactly 1 match
  IF v_match_id IS NULL THEN
    SELECT count(*) INTO v_name_matches
    FROM contacts c
    WHERE c.name ILIKE p_name;

    IF v_name_matches = 1 THEN
      SELECT c.id INTO v_match_id
      FROM contacts c
      WHERE c.name ILIKE p_name;
      v_matched_on := 'name';
    ELSIF v_name_matches > 1 THEN
      -- Multiple matches: return them for disambiguation
      SELECT jsonb_agg(jsonb_build_object(
        'id', c.id,
        'name', c.name,
        'organization', c.organization,
        'email', c.email
      ))
      INTO v_match_names
      FROM contacts c
      WHERE c.name ILIKE p_name;

      RETURN jsonb_build_object(
        'action', 'disambiguation_needed',
        'message', 'Multiple contacts match name "' || p_name || '". Provide email or organization to disambiguate.',
        'matches', v_match_names
      );
    END IF;
  END IF;

  -- UPDATE existing contact
  IF v_match_id IS NOT NULL THEN
    UPDATE contacts SET
      name = COALESCE(p_name, contacts.name),
      email = COALESCE(p_email, contacts.email),
      phone = COALESCE(p_phone, contacts.phone),
      organization = COALESCE(p_organization, contacts.organization),
      role = COALESCE(p_role, contacts.role),
      relationship = COALESCE(p_relationship, contacts.relationship),
      context = CASE
        WHEN p_context IS NOT NULL AND contacts.context IS NOT NULL
          THEN contacts.context || E'\n' || p_context
        ELSE COALESCE(p_context, contacts.context)
      END,
      tags = CASE
        WHEN array_length(p_tags, 1) > 0
          THEN (SELECT array_agg(DISTINCT t) FROM unnest(contacts.tags || p_tags) t)
        ELSE contacts.tags
      END,
      last_contact = GREATEST(p_last_contact, contacts.last_contact),
      next_followup = COALESCE(p_next_followup, contacts.next_followup),
      followup_note = COALESCE(p_followup_note, contacts.followup_note),
      source_ref = CASE
        WHEN p_source_ref != '{}'::jsonb THEN contacts.source_ref || p_source_ref
        ELSE contacts.source_ref
      END,
      metadata = CASE
        WHEN p_metadata != '{}'::jsonb THEN contacts.metadata || p_metadata
        ELSE contacts.metadata
      END,
      embedding = COALESCE(p_embedding, contacts.embedding)
    WHERE contacts.id = v_match_id;

    RETURN jsonb_build_object(
      'id', v_match_id,
      'action', 'updated',
      'matched_on', v_matched_on
    );
  END IF;

  -- INSERT new contact
  INSERT INTO contacts (
    name, email, phone, organization, role, relationship,
    context, tags, last_contact, next_followup, followup_note,
    source_ref, metadata, embedding
  ) VALUES (
    p_name, p_email, p_phone, p_organization, p_role, p_relationship,
    p_context, p_tags, p_last_contact, p_next_followup, p_followup_note,
    p_source_ref, p_metadata, p_embedding
  )
  RETURNING id INTO v_match_id;

  RETURN jsonb_build_object(
    'id', v_match_id,
    'action', 'created',
    'matched_on', null
  );
END;
$$;

-- Rollback:
-- DROP FUNCTION IF EXISTS match_contacts(vector(1536), float, int);
-- DROP FUNCTION IF EXISTS upsert_contact(text, text, text, text, text, text, text, text[], timestamptz, timestamptz, text, jsonb, jsonb, vector(1536));
