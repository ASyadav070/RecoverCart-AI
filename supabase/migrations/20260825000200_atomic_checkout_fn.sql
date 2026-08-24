-- Migration: atomic checkout creation function
-- Drops the redundant explicit index on session_token_hash (the UNIQUE constraint
-- already creates a unique index — a second btree index on the same column is wasteful).
drop index if exists idx_checkout_sessions_hash;

-- ---------------------------------------------------------------------------
-- create_checkout_session
-- Atomically creates: checkout + checkout_items + checkout_session in one tx.
-- Prices are re-read authoritatively inside the function using SELECT ... FOR UPDATE.
-- Client-provided prices/totals are never accepted.
-- The raw session token is never passed in or stored here.
-- ---------------------------------------------------------------------------
create or replace function create_checkout_session(
  p_customer_email    text,
  p_customer_phone    text,
  p_preferred_channel text,
  p_consent_given     boolean,
  p_items             jsonb,       -- [{product_id: uuid, quantity: int}, ...]
  p_session_token_hash text,       -- SHA-256 hex of the raw token (generated server-side)
  p_session_expires_at timestamptz
)
returns uuid                       -- returns the new checkout_id
language plpgsql
security definer                   -- runs as owner, not as the calling role
set search_path = public
as $$
declare
  v_checkout_id     uuid;
  v_total_paise     bigint := 0;
  v_item            jsonb;
  v_product_id      uuid;
  v_quantity        integer;
  v_price_paise     bigint;
  v_stock           integer;
  v_product_name    text;
  v_line_total      bigint;
begin
  -- Guard: consent is mandatory
  if p_consent_given is not true then
    raise exception 'consent_required'
      using hint = 'Recovery contact consent is required';
  end if;

  -- Guard: channel must be one of the allowed values
  if p_preferred_channel not in ('EMAIL', 'WHATSAPP') then
    raise exception 'invalid_channel'
      using hint = 'Channel must be EMAIL or WHATSAPP';
  end if;

  -- Guard: cart must not be empty
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'empty_cart'
      using hint = 'Cart must contain at least one item';
  end if;

  -- Guard: cart size upper bound (matches application Zod limit)
  if jsonb_array_length(p_items) > 20 then
    raise exception 'cart_too_large'
      using hint = 'Cart cannot contain more than 20 distinct items';
  end if;

  -- Create the checkout row with a placeholder total; we will update it below.
  -- Status is always STARTED here — the function never creates any other status.
  insert into checkouts (
    status,
    customer_email,
    customer_phone,
    preferred_channel,
    consent_given,
    total_amount_paise
  ) values (
    'STARTED',
    p_customer_email,
    p_customer_phone,
    p_preferred_channel,
    p_consent_given,
    0   -- placeholder; updated atomically after items loop
  )
  returning id into v_checkout_id;

  -- Process each item: re-read prices and stock with a row-level lock to
  -- prevent race conditions with concurrent stock changes.
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_product_id := (v_item->>'product_id')::uuid;
    v_quantity   := (v_item->>'quantity')::integer;

    -- Per-item quantity guard (mirrors Zod: 1..99)
    if v_quantity < 1 or v_quantity > 99 then
      raise exception 'invalid_quantity'
        using hint = format('Quantity must be between 1 and 99, got %s', v_quantity);
    end if;

    -- Authoritative price + stock read with row lock
    select name, price_paise, stock
    into   v_product_name, v_price_paise, v_stock
    from   products
    where  id = v_product_id
    for update;

    if not found then
      raise exception 'product_not_found'
        using hint = format('Product %s not found', v_product_id);
    end if;

    if v_stock < v_quantity then
      raise exception 'insufficient_stock'
        using hint = format(
          'Insufficient stock for "%s". Available: %s, requested: %s',
          v_product_name, v_stock, v_quantity
        );
    end if;

    v_line_total  := v_price_paise * v_quantity;
    v_total_paise := v_total_paise + v_line_total;

    insert into checkout_items (
      checkout_id,
      product_id,
      product_name_snapshot,
      unit_price_paise_snapshot,
      quantity,
      line_total_paise
    ) values (
      v_checkout_id,
      v_product_id,
      v_product_name,
      v_price_paise,
      v_quantity,
      v_line_total
    );
  end loop;

  -- Backfill the authoritative total (never the client's value)
  update checkouts
  set    total_amount_paise = v_total_paise
  where  id = v_checkout_id;

  -- Insert the hashed session token; the raw token never enters the database
  insert into checkout_sessions (
    checkout_id,
    session_token_hash,
    expires_at
  ) values (
    v_checkout_id,
    p_session_token_hash,
    p_session_expires_at
  );

  return v_checkout_id;
end;
$$;

-- Revoke execute from all public roles; only service_role (superuser-equivalent)
-- will call this function from the server-side Supabase admin client.
revoke execute on function create_checkout_session(
  text, text, text, boolean, jsonb, text, timestamptz
) from public;

-- Explicit deny for anon and authenticated (belt-and-suspenders)
do $$
begin
  -- anon and authenticated exist in every Supabase project; ignore if absent
  begin
    revoke execute on function create_checkout_session(
      text, text, text, boolean, jsonb, text, timestamptz
    ) from anon;
  exception when undefined_object then null;
  end;
  begin
    revoke execute on function create_checkout_session(
      text, text, text, boolean, jsonb, text, timestamptz
    ) from authenticated;
  exception when undefined_object then null;
  end;
end;
$$;
