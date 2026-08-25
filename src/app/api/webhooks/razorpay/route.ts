import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { getRazorpayClient } from '@/lib/razorpay';
import crypto from 'crypto';

export async function POST(request: Request) {
    try {
        const text = await request.text();
        const signature = request.headers.get('x-razorpay-signature');

        if (!signature || !process.env.RAZORPAY_WEBHOOK_SECRET) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const expectedSignature = crypto
            .createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET)
            .update(text)
            .digest('hex');

        if (signature !== expectedSignature) {
            return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
        }

        const event = JSON.parse(text);
        const dbAdmin = getSupabaseAdmin();

        // Deduplication check - if already PROCESSED, return 200 immediately
        const { data: existing } = await dbAdmin
            .from('razorpay_webhook_events')
            .select('status')
            .eq('rzp_event_id', event.id)
            .maybeSingle();

        if (existing?.status === 'PROCESSED') return new NextResponse(null, { status: 200 });

        // Handle PENDING -> PROCESSING transition
        if (existing?.status === 'PENDING') {
            await dbAdmin
                .from('razorpay_webhook_events')
                .update({ status: 'PROCESSING' })
                .eq('rzp_event_id', event.id);
        }

        // Logic for payment.captured
        if (event.event === 'payment.captured') {
            const paymentId = event.payload.payment.entity.id;
            const rzp = getRazorpayClient();
            const payment = await rzp.payments.fetch(paymentId);

            if (payment.status !== 'captured' || !payment.captured) {
                await dbAdmin
                    .from('razorpay_webhook_events')
                    .update({ status: 'FAILED' })
                    .eq('rzp_event_id', event.id);
                return NextResponse.json({ error: 'Payment not captured' }, { status: 400 });
            }

            // Call atomic capture RPC
            await dbAdmin.rpc('capture_payment', {
                p_rzp_order_id: event.payload.payment.entity.order_id,
                p_rzp_payment_id: paymentId,
                p_amount: payment.amount,
                p_event_id: event.id
            });

            await dbAdmin
                .from('razorpay_webhook_events')
                .update({ status: 'PROCESSED', processed_at: new Date().toISOString() })
                .eq('rzp_event_id', event.id);

            return new NextResponse(null, { status: 200 });
        }

        // Handle other valid signed events - safely record and ignore for financial change
        await dbAdmin
            .from('razorpay_webhook_events')
            .update({ status: 'PROCESSED', processed_at: new Date().toISOString() })
            .eq('rzp_event_id', event.id);

        return new NextResponse(null, { status: 200 });
    } catch {
        return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 });
    }
}
