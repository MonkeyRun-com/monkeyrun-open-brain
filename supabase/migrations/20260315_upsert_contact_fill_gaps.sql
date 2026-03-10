-- Add p_fill_gaps_only param to upsert_contact RPC
-- When true, flips COALESCE order on UPDATE so existing data wins over incoming data.
-- Designed for bulk imports (e.g. Google Contacts) where curated data should not be overwritten.

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
  p_embedding vector(1536) DEFAULT NULL,
  p_clear_followup boolean DEFAULT false,
  p_fill_gaps_only boolean DEFAULT false
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
      name = CASE
        WHEN p_fill_gaps_only THEN COALESCE(contacts.name, p_name)
        ELSE COALESCE(p_name, contacts.name)
      END,
      email = CASE
        WHEN p_fill_gaps_only THEN COALESCE(contacts.email, p_email)
        ELSE COALESCE(p_email, contacts.email)
      END,
      phone = CASE
        WHEN p_fill_gaps_only THEN COALESCE(contacts.phone, p_phone)
        ELSE COALESCE(p_phone, contacts.phone)
      END,
      organization = CASE
        WHEN p_fill_gaps_only THEN COALESCE(contacts.organization, p_organization)
        ELSE COALESCE(p_organization, contacts.organization)
      END,
      role = CASE
        WHEN p_fill_gaps_only THEN COALESCE(contacts.role, p_role)
        ELSE COALESCE(p_role, contacts.role)
      END,
      relationship = CASE
        WHEN p_fill_gaps_only THEN COALESCE(contacts.relationship, p_relationship)
        ELSE COALESCE(p_relationship, contacts.relationship)
      END,
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
      next_followup = CASE
        WHEN p_clear_followup THEN NULL
        ELSE COALESCE(p_next_followup, contacts.next_followup)
      END,
      followup_note = CASE
        WHEN p_clear_followup THEN NULL
        ELSE COALESCE(p_followup_note, contacts.followup_note)
      END,
      source_ref = CASE
        WHEN p_source_ref != '{}'::jsonb THEN contacts.source_ref || p_source_ref
        ELSE contacts.source_ref
      END,
      metadata = CASE
        WHEN p_metadata != '{}'::jsonb THEN contacts.metadata || p_metadata
        ELSE contacts.metadata
      END,
      embedding = CASE
        WHEN p_fill_gaps_only THEN COALESCE(contacts.embedding, p_embedding)
        ELSE COALESCE(p_embedding, contacts.embedding)
      END
    WHERE contacts.id = v_match_id;

    RETURN jsonb_build_object(
      'id', v_match_id,
      'action', 'updated',
      'matched_on', v_matched_on
    );
  END IF;

  -- INSERT new contact (no existing data to preserve, fill_gaps_only irrelevant)
  INSERT INTO contacts (
    name, email, phone, organization, role, relationship,
    context, tags, last_contact, next_followup, followup_note,
    source_ref, metadata, embedding
  ) VALUES (
    p_name, p_email, p_phone, p_organization, p_role, p_relationship,
    p_context, p_tags, p_last_contact,
    CASE WHEN p_clear_followup THEN NULL ELSE p_next_followup END,
    CASE WHEN p_clear_followup THEN NULL ELSE p_followup_note END,
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
-- Re-run 20260314_upsert_contact_clear_followup.sql (without p_fill_gaps_only)
