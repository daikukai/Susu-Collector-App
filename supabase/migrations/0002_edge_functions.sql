-- SQL functions for Edge Functions to ensure atomic transactions

-- Function to record a payment transaction with SMS log atomically
CREATE OR REPLACE FUNCTION record_payment_transaction(
  p_group_id UUID,
  p_member_id UUID,
  p_amount NUMERIC,
  p_date TEXT,
  p_method TEXT,
  p_note TEXT,
  p_display_id TEXT,
  p_collector_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_transaction RECORD;
  v_sms_log RECORD;
  v_result JSONB;
BEGIN
  -- Insert transaction
  INSERT INTO transactions (
    group_id,
    member_id,
    type,
    amount,
    date,
    timestamp,
    method,
    note,
    display_id,
    collector_id
  ) VALUES (
    p_group_id,
    p_member_id,
    'contribution',
    p_amount,
    p_date,
    NOW(),
    p_method,
    p_note,
    p_display_id,
    p_collector_id
  ) RETURNING * INTO v_transaction;

  -- Insert SMS log
  INSERT INTO sms_log (
    member_id,
    kind,
    status,
    timestamp,
    content,
    collector_id
  ) VALUES (
    p_member_id,
    'Receipt',
    'Delivered',
    NOW(),
    'Payment receipt for ' || p_amount,
    p_collector_id
  ) RETURNING * INTO v_sms_log;

  -- Return both records
  v_result := jsonb_build_object(
    'transaction', to_jsonb(v_transaction),
    'sms_log', to_jsonb(v_sms_log)
  );

  RETURN v_result;
END;
$$;

-- Function to record a correction transaction atomically
CREATE OR REPLACE FUNCTION record_correction_transaction(
  p_group_id UUID,
  p_member_id UUID,
  p_amount NUMERIC,
  p_date TEXT,
  p_method TEXT,
  p_note TEXT,
  p_supersedes UUID,
  p_original_amount NUMERIC,
  p_collector_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_transaction RECORD;
  v_result JSONB;
BEGIN
  -- Insert correction transaction
  INSERT INTO transactions (
    group_id,
    member_id,
    type,
    amount,
    date,
    timestamp,
    method,
    note,
    supersedes,
    original_amount,
    collector_id
  ) VALUES (
    p_group_id,
    p_member_id,
    'correction',
    p_amount,
    p_date,
    NOW(),
    p_method,
    p_note,
    p_supersedes,
    p_original_amount,
    p_collector_id
  ) RETURNING * INTO v_transaction;

  -- Return the transaction
  v_result := jsonb_build_object(
    'transaction', to_jsonb(v_transaction)
  );

  RETURN v_result;
END;
$$;

-- Function to close a cycle (archive group) atomically
CREATE OR REPLACE FUNCTION close_cycle_transaction(
  p_group_id UUID,
  p_collector_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_group RECORD;
  v_result JSONB;
BEGIN
  -- Archive the group
  UPDATE groups
  SET archived = true,
      virtual_date = NULL
  WHERE id = p_group_id
  AND collector_id = p_collector_id
  RETURNING * INTO v_group;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Group not found or unauthorized';
  END IF;

  -- Return the updated group
  v_result := jsonb_build_object(
    'group', to_jsonb(v_group)
  );

  RETURN v_result;
END;
$$;
