import { NextResponse } from 'next/server';
import { getRazorpayClient } from '@/lib/razorpay';
import { getSupabaseAdmin } from '@/lib/supabase';
import { hashToken } from '@/lib/token';

import { z } from 'zod';

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const schema = z.object({ token: z.string().min(1) });
        const parsed = schema.safeParse(body);
        if (!parsed.success) return NextResponse.json({ error: 'Body invalid' }, { status: 400 });

        const { token } = parsed.data;
        const tokenHash = hashToken(token);
        const dbAdmin = getSupabaseAdmin();
        const currency = 'INR';

        // 1. Verify session exists and is not expired
        const { data: session, error: sessionError } = await dbAdmin
            .from('checkout_sessions')
            .select('checkout_id, expires_at')
            .eq('session_token_hash', tokenHash)
            .gt('expires_at', new Date().toISOString())
            .single();

        if (sessionError || !session) return NextResponse.json({ error: 'Invalid or expired token' }, { status: 400 });

        // 2. Fetch the linked checkout using explicit columns
        const { data: checkout, error: checkoutError } = await dbAdmin
            .from('checkouts')
            .select('id, status, total_amount_paise')
            .eq("id", session.checkout_id)
            .maybeSingle();

        if (checkoutError) {
            console.error("checkout lookup failed", {
                stage: "CHECKOUT_QUERY",
                code: checkoutError.code,
                message: checkoutError.message,
                details: checkoutError.details,
                hint: checkoutError.hint,
            });
            return NextResponse.json(
                { error: "Checkout lookup failed", code: "CHECKOUT_QUERY_FAILED" },
                { status: 500 }
            );
        }

        if (!checkout) {
            return NextResponse.json(
                { error: "Checkout not found", code: "CHECKOUT_NOT_FOUND" },
                { status: 404 }
            );
        }

        // 3. Validate state and monetary data
        if (checkout.status !== "STARTED") {
            return NextResponse.json(
                { error: "Checkout is not payable", code: "CHECKOUT_NOT_PAYABLE" },
                { status: 409 }
            );
        }
        if (typeof checkout.total_amount_paise !== 'number' || checkout.total_amount_paise <= 0) {
            return NextResponse.json({ error: 'Invalid authoritative monetary data' }, { status: 500 });
        }

        const idempotencyKey = `order_${checkout.id}_INITIAL`;
        
        interface PaymentOrder {
            order_id: string;
            rzp_order_id: string;
            status: string;
            claimed_by_caller: boolean;
        }

        const { data: order, error: rpcError } = await dbAdmin.rpc('get_or_create_payment_order', {
            p_checkout_id: checkout.id,
            p_purpose: 'INITIAL',
            p_amount_paise: checkout.total_amount_paise,
            p_currency: currency,
            p_idempotency_key: idempotencyKey
        }).returns<PaymentOrder | null>().single();

        if (rpcError) {
             console.error("RPC error", { stage: "RPC", code: rpcError.code, message: rpcError.message, details: rpcError.details, hint: rpcError.hint });
             return NextResponse.json({ error: 'Failed to manage order' }, { status: 500 });
        }

        const castOrder = order as unknown as PaymentOrder | null;

        if (!castOrder) {
             return NextResponse.json({ error: 'Failed to manage order' }, { status: 500 });
        }

        if (castOrder.claimed_by_caller) {
            try {
                const rzp = getRazorpayClient();
                const rzpOrder = await rzp.orders.create({
                    amount: checkout.total_amount_paise,
                    currency: currency,
                    receipt: idempotencyKey,
                });
                
                const { error: updateError } = await dbAdmin
                    .from('payment_orders')
                    .update({ rzp_order_id: rzpOrder.id, status: 'CREATED' })
                    .eq('id', castOrder.order_id);
                
                if (updateError) throw updateError;
                    
                return NextResponse.json({ 
                    key: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID,
                    order_id: rzpOrder.id,
                    amount: checkout.total_amount_paise,
                    currency
                });
            } catch (err) {
                 console.error("Razorpay order creation failed", err);
                 return NextResponse.json({ error: 'Failed to create payment order' }, { status: 502 });
            }
        }

        return NextResponse.json({ 
            key: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID,
            order_id: castOrder.rzp_order_id,
            amount: checkout.total_amount_paise,
            currency
        });
    } catch {
        return NextResponse.json({ error: 'Failed' }, { status: 500 });
    }
}
