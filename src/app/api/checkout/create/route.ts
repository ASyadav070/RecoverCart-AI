import { NextResponse } from 'next/server';
import { z } from 'zod';
import crypto from 'crypto';
import { getSupabaseAdmin } from '@/lib/supabase';

// ---------------------------------------------------------------------------
// Input validation schema — enforces strict bounds on all browser inputs.
// Prices and totals are intentionally absent: the DB function recalculates them.
// ---------------------------------------------------------------------------
const checkoutCreateSchema = z.object({
  email: z
    .string()
    .email('Invalid email address')
    .max(254, 'Email address is too long'),
  phone: z
    .string()
    .min(7, 'Phone number is too short')
    .max(15, 'Phone number is too long (max 15 digits)'),
  channelPreference: z.enum(['EMAIL', 'WHATSAPP'], {
    message: 'Channel must be EMAIL or WHATSAPP',
  }),
  consentGiven: z.literal(true, {
    message: 'Recovery contact consent is required',
  }),
  items: z
    .array(
      z.object({
        productId: z.string().uuid('Invalid product ID'),
        quantity: z
          .number()
          .int('Quantity must be a whole number')
          .min(1, 'Quantity must be at least 1')
          .max(99, 'Quantity cannot exceed 99 per item'),
      })
    )
    .min(1, 'Cart must contain at least one item')
    .max(20, 'Cart cannot contain more than 20 distinct items'),
});

// Map PostgreSQL exception codes/messages to client-safe HTTP responses
function pgErrorToResponse(hint: string | undefined): NextResponse {
  const h = hint ?? '';
  if (h.startsWith('Insufficient stock')) {
    return NextResponse.json({ error: h }, { status: 409 });
  }
  if (h.startsWith('Product') && h.includes('not found')) {
    return NextResponse.json({ error: 'One or more products in your cart are no longer available' }, { status: 400 });
  }
  if (h === 'consent_required') {
    return NextResponse.json({ error: 'Recovery contact consent is required' }, { status: 400 });
  }
  if (h === 'empty_cart') {
    return NextResponse.json({ error: 'Cart must contain at least one item' }, { status: 400 });
  }
  if (h === 'cart_too_large') {
    return NextResponse.json({ error: 'Cart cannot contain more than 20 distinct items' }, { status: 400 });
  }
  return NextResponse.json({ error: 'Failed to create checkout session' }, { status: 500 });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();

    // 1. Validate all browser-supplied fields
    const parsed = checkoutCreateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const { email, phone, channelPreference, consentGiven, items } = parsed.data;

    // 2. Generate the cryptographically strong session token server-side.
    //    Only the SHA-256 hash is passed into the database — the raw token
    //    is returned to the browser for use in the redirect URL only.
    const rawToken = crypto.randomUUID();
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    const dbAdmin = getSupabaseAdmin();

    // 3. Call the atomic PostgreSQL RPC.
    //    All pricing, stock checks, and total calculation happen inside
    //    the database transaction — no client-supplied amounts accepted.
    const { error: rpcError } = await dbAdmin.rpc('create_checkout_session', {
      p_customer_email:     email,
      p_customer_phone:     phone,
      p_preferred_channel:  channelPreference,
      p_consent_given:      consentGiven,
      p_items:              items.map(i => ({ product_id: i.productId, quantity: i.quantity })),
      p_session_token_hash: tokenHash,
      p_session_expires_at: expiresAt.toISOString(),
    });

    if (rpcError) {
      console.error('create_checkout_session RPC error:', rpcError);
      // Extract the HINT field that the PL/pgSQL function raises
      const hint = (rpcError as { hint?: string }).hint;
      return pgErrorToResponse(hint);
    }

    // 4. Return only the unhashed raw token; it is never stored in the database
    return NextResponse.json({ success: true, token: rawToken });

  } catch (error) {
    console.error('Checkout creation unexpected error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
