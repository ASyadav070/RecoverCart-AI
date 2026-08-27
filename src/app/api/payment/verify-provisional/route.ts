import 'server-only';
import { NextResponse } from 'next/server';
import { hashToken } from '@/lib/token';
import { getSupabaseAdmin } from '@/lib/supabase';
import { z } from 'zod';
import crypto from 'crypto';

export async function POST(request: Request) {
  try {
    const bodyText = await request.text();
    const schema = z.object({
      token: z.string().min(1),
      razorpay_payment_id: z.string().min(5).max(64).regex(/^pay_[A-Za-z0-9]+$/, 'Invalid payment ID'),
      razorpay_order_id: z.string().regex(/^order_[a-zA-Z0-9]+$/, 'Invalid Razorpay order ID'),
      razorpay_signature: z.string().regex(/^[0-9a-f]{64}$/, 'Invalid signature format (expected 64-char hex)'),
    });
    const parsed = schema.safeParse(JSON.parse(bodyText));
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid input' }, { status: 400 });
    }

    const { token, razorpay_payment_id, razorpay_order_id, razorpay_signature } = parsed.data;

    // 1. Resolve authoritative state server-side
    const tokenHash = hashToken(token);
    const { data: session, error: sessionError } = await getSupabaseAdmin()
      .from('checkout_sessions')
      .select('checkout_id, expires_at')
      .eq('session_token_hash', tokenHash)
      .single();

    if (sessionError || !session) {
      return NextResponse.json({ error: 'Invalid session' }, { status: 400 });
    }

    const now = new Date().toISOString();
    if (session.expires_at < now) {
      return NextResponse.json({ error: 'Session expired' }, { status: 400 });
    }

    // 2. Fetch authoritative payment order from payment_orders table
    const { data: paymentOrder, error: paymentOrderError } = await getSupabaseAdmin()
      .from('payment_orders')
      .select('rzp_order_id, amount_paise, currency, status')
      .eq('checkout_id', session.checkout_id)
      .eq('purpose', 'INITIAL')
      .single();

    if (paymentOrderError || !paymentOrder) {
      return NextResponse.json({ error: 'Payment order not found' }, { status: 400 });
    }

    // 3. Require the browser-provided razorpay_order_id to match the authoritative rzp_order_id
    if (paymentOrder.rzp_order_id !== razorpay_order_id) {
      return NextResponse.json({ error: 'Order ID mismatch' }, { status: 400 });
    }

    // 4. Verify the Checkout success signature using RAZORPAY_KEY_SECRET
    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET!)
      .update(razorpay_order_id + '|' + razorpay_payment_id)
      .digest('hex');

    if (!crypto.timingSafeEqual(Buffer.from(expectedSignature), Buffer.from(razorpay_signature))) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }

    // 5. Optionally fetch the payment through the server-side Razorpay API
    // In production, fetch payment details and verify:
    // - payment.id matches razorpay_payment_id
    // - payment.order_id matches the authoritative order
    // - payment.amount matches paymentOrder.amount_paise
    // - payment.currency matches paymentOrder.currency
    // - status is authorized or captured

    return NextResponse.json({ provisional: true, order_id: paymentOrder.rzp_order_id });
  } catch {
    return NextResponse.json({ error: 'Verification failed' }, { status: 500 });
  }
}
