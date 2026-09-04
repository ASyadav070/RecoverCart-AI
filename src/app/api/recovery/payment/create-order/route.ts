import { NextResponse } from 'next/server';
import { getRazorpayClient } from '@/lib/razorpay';
import { getSupabaseAdmin } from '@/lib/supabase';
import { hashToken } from '@/lib/token';
import { z } from 'zod';

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const schema = z.object({ token: z.string().regex(/^[0-9a-fA-F]{64}$/) });
        const parsed = schema.safeParse(body);
        if (!parsed.success) return NextResponse.json({ error: 'Recovery link not found' }, { status: 404 });

        const { token } = parsed.data;
        const tokenHash = hashToken(token);
        const dbAdmin = getSupabaseAdmin();

        // 1. Resolve recovery outreach and session
        const { data: outreach, error: outreachError } = await dbAdmin
            .from('recovery_outreach')
            .select(`
                id, 
                expires_at, 
                opened_at,
                recovery_case:recovery_cases(id, status, checkout_id)
            `)
            .eq('recovery_token_hash', tokenHash)
            .single();

        if (outreachError || !outreach || !outreach.recovery_case) {
            return NextResponse.json({ error: 'Recovery link not found' }, { status: 404 });
        }

        if (new Date(outreach.expires_at) < new Date()) {
            return NextResponse.json({ error: 'Recovery link expired' }, { status: 410 });
        }

        if (!outreach.opened_at) {
            return NextResponse.json({ error: 'Recovery link unavailable' }, { status: 409 });
        }

        const recoveryCase = Array.isArray(outreach.recovery_case) ? outreach.recovery_case[0] : outreach.recovery_case;
        if (!recoveryCase || recoveryCase.status !== 'MONITORING') {
            return NextResponse.json({ error: 'Recovery session is not active' }, { status: 409 });
        }

        // 2. Resolve checkout
        const { data: checkout, error: checkoutError } = await dbAdmin
            .from('checkouts')
            .select('id, status, total_amount_paise')
            .eq('id', recoveryCase.checkout_id)
            .single();

        if (checkoutError || !checkout) {
            return NextResponse.json({ error: 'Unable to prepare payment' }, { status: 500 });
        }

        if (checkout.status === 'PAID') {
            return NextResponse.json({ error: 'Checkout already paid' }, { status: 409 });
        }

        if (typeof checkout.total_amount_paise !== 'number' || checkout.total_amount_paise <= 0) {
            return NextResponse.json({ error: 'Unable to prepare payment' }, { status: 500 });
        }

        // 3. Prepare payment order
        const idempotencyKey = `recovery_${recoveryCase.id}_${checkout.id}`;

        interface PaymentOrder {
            order_id: string;
            rzp_order_id: string;
            status: string;
            claimed_by_caller: boolean;
        }

        const { data, error: rpcError } = await dbAdmin.rpc('get_or_create_payment_order', {
            p_checkout_id: checkout.id,
            p_purpose: 'RECOVERY',
            p_amount_paise: checkout.total_amount_paise,
            p_currency: 'INR',
            p_idempotency_key: idempotencyKey
        });

        const order = data as unknown as PaymentOrder[] | null;

        if (rpcError || !order || order.length === 0) {
            return NextResponse.json({ error: 'Unable to prepare payment' }, { status: 500 });
        }

        const paymentOrder = order[0];

        // 4. Create Razorpay order if needed
        let resolvedRazorpayOrderId = paymentOrder.rzp_order_id;
        if (paymentOrder.claimed_by_caller) {
            let rzpOrder;
            try {
                const rzp = getRazorpayClient();
                const razorpayReceipt = `rec_${paymentOrder.order_id.replace(/-/g, '').slice(0, 32)}`;
                rzpOrder = await rzp.orders.create({
                    amount: checkout.total_amount_paise,
                    currency: 'INR',
                    receipt: razorpayReceipt,
                });
            } catch {
                console.error("Razorpay order creation failed");
                return NextResponse.json({ error: 'Unable to prepare payment' }, { status: 502 });
            }

            if (!rzpOrder || !rzpOrder.id) {
                return NextResponse.json({ error: 'Unable to prepare payment' }, { status: 500 });
            }

            const { error: updateError } = await dbAdmin
                .from('payment_orders')
                .update({ rzp_order_id: rzpOrder.id, status: 'CREATED' })
                .eq('id', paymentOrder.order_id);

            if (updateError) {
                console.error("Payment order update failed");
                return NextResponse.json({ error: 'Unable to prepare payment' }, { status: 500 });
            }
            resolvedRazorpayOrderId = rzpOrder.id;
        }

        if (!resolvedRazorpayOrderId) {
            return NextResponse.json({ error: 'Unable to prepare payment' }, { status: 500 });
        }

        if (await isCheckoutPaid(dbAdmin, checkout.id)) {
            return NextResponse.json({ error: 'Checkout already paid' }, { status: 409 });
        }

        return NextResponse.json({
            key: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID,
            order_id: resolvedRazorpayOrderId,
            amount: checkout.total_amount_paise,
            currency: 'INR'
        });

    } catch {
        console.error("Recovery payment order preparation failed");
        return NextResponse.json({ error: 'Unable to prepare payment' }, { status: 500 });
    }
}

async function isCheckoutPaid(db: import('@supabase/supabase-js').SupabaseClient, checkoutId: string): Promise<boolean> {
    const { data, error } = await db
        .from('checkouts')
        .select('status')
        .eq('id', checkoutId)
        .single();
    if (error || !data) throw new Error('DB_FAILURE');
    return data.status === 'PAID';
}
