import { NextResponse } from 'next/server';
import { getRazorpayClient } from '@/lib/razorpay';
import { getSupabaseAdmin } from '@/lib/supabase';
import crypto from 'crypto';

export async function POST(request: Request) {
    try {
        const { token } = await request.json();
        const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
        const dbAdmin = getSupabaseAdmin();

        const { data: checkout, error: checkoutError } = await dbAdmin
            .from('checkouts')
            .select('id, total_amount_paise, currency')
            .eq('session_token_hash', tokenHash)
            .single();

        if (checkoutError || !checkout) return NextResponse.json({ error: 'Invalid token' }, { status: 400 });

        const idempotencyKey = `order_${checkout.id}_INITIAL`;
        
        const { data: order, error: rpcError } = await dbAdmin.rpc('get_or_create_payment_order', {
            p_checkout_id: checkout.id,
            p_purpose: 'INITIAL',
            p_amount_paise: checkout.total_amount_paise,
            p_currency: checkout.currency,
            p_idempotency_key: idempotencyKey
        });

        if (rpcError) return NextResponse.json({ error: 'Failed to manage order' }, { status: 500 });

        if (order.claimed_by_caller) {
            const rzp = getRazorpayClient();
            const rzpOrder = await rzp.orders.create({
                amount: checkout.total_amount_paise,
                currency: checkout.currency,
                receipt: idempotencyKey,
            });
            
            await dbAdmin
                .from('payment_orders')
                .update({ rzp_order_id: rzpOrder.id, status: 'CREATED' })
                .eq('id', order.order_id);
                
            return NextResponse.json({ order_id: rzpOrder.id });
        }

        return NextResponse.json({ order_id: order.rzp_order_id });
    } catch {
        return NextResponse.json({ error: 'Failed' }, { status: 500 });
    }
}
