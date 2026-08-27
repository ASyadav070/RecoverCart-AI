import 'server-only';
import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { getRazorpayClient } from '@/lib/razorpay';
import { z } from 'zod';
import crypto from 'crypto';

export async function POST(request: Request) {
  try {
    // 1. Read request.text() exactly once and verify the signature against the untouched raw body
    const text = await request.text();
    const signature = request.headers.get('x-razorpay-signature');
    const eventId = request.headers.get('x-razorpay-event-id');

    // 2. Require both headers
    if (!signature || !eventId) {
      return NextResponse.json({ error: 'Missing required headers' }, { status: 400 });
    }

    // 3. Validate webhook signature as 64 hex characters before timingSafeEqual
    if (!process.env.RAZORPAY_WEBHOOK_SECRET) {
      return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 500 });
    }
    if (!/^[0-9a-f]{64}$/i.test(signature)) {
      return NextResponse.json({ error: 'Invalid signature format' }, { status: 401 });
    }

    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET)
      .update(text)
      .digest('hex');

    if (!crypto.timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expectedSignature, 'hex'))) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }

    // 4. Parse JSON only after successful signature verification
    let event;
    try {
      event = JSON.parse(text);
    } catch {
      return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
    }

    // 5. Validate payload with Zod - discriminated union for different event types
    const capturedSchema = z.object({
      event: z.literal('payment.captured'),
      payload: z.object({
        payment: z.object({
          entity: z.object({
            id: z.string().regex(/^pay_[A-Za-z0-9]+$/, 'Invalid payment ID'),
            order_id: z.string().regex(/^order_[A-Za-z0-9]+$/, 'Invalid order ID'),
            amount: z.number().int().positive(),
            currency: z.string().length(3),
            status: z.literal('captured'),
            captured: z.boolean(),
          }),
        }),
      }),
    });

    const failedSchema = z.object({
      event: z.literal('payment.failed'),
      payload: z.object({
        payment: z.object({
          entity: z.object({
            id: z.string().regex(/^pay_[A-Za-z0-9]+$/, 'Invalid payment ID'),
            order_id: z.string().regex(/^order_[A-Za-z0-9]+$/, 'Invalid order ID'),
            amount: z.number().int().positive(),
            currency: z.string().length(3),
            error_code: z.string().optional(),
            error_description: z.string().optional(),
            error_source: z.string().optional(),
            error_step: z.string().optional(),
            error_reason: z.string().optional(),
          }),
        }),
      }),
    });

    // Try to parse as either captured or failed
    let eventType: 'payment.captured' | 'payment.failed' | 'other' = 'other';
    let paymentId: string | null = null;
    let rzpOrderId: string | null = null;
    let amount: number | null = null;
    let currency: string | null = null;
    let paymentStatus: string | null = null;

    const capturedResult = capturedSchema.safeParse(event);
    if (capturedResult.success) {
      eventType = 'payment.captured';
      paymentId = capturedResult.data.payload.payment.entity.id;
      rzpOrderId = capturedResult.data.payload.payment.entity.order_id;
      amount = capturedResult.data.payload.payment.entity.amount;
      currency = capturedResult.data.payload.payment.entity.currency.toUpperCase();
      paymentStatus = capturedResult.data.payload.payment.entity.status;
    } else {
      const failedResult = failedSchema.safeParse(event);
      if (failedResult.success) {
        eventType = 'payment.failed';
        paymentId = failedResult.data.payload.payment.entity.id;
        rzpOrderId = failedResult.data.payload.payment.entity.order_id;
        amount = failedResult.data.payload.payment.entity.amount;
        currency = failedResult.data.payload.payment.entity.currency.toUpperCase();
        paymentStatus = 'failed';
      }
    }

    if (eventType === 'payment.captured' || eventType === 'payment.failed') {
      const dbAdmin = getSupabaseAdmin();

      // 6. Call claim_webhook_event before any processing
      const { data: claimResult, error: claimError } = await dbAdmin.rpc('claim_webhook_event', {
        p_event_id: eventId,
        p_event_type: eventType,
        p_payload: {
          event_type: eventType,
          payment_id: paymentId!,
          order_id: rzpOrderId!,
          amount: amount!,
          currency: currency!,
          status: paymentStatus!,
        },
      });

      if (claimError) {
        console.error('Webhook claim failed', { stage: 'CLAIM', code: claimError.code, message: claimError.message, details: claimError.details, hint: claimError.hint });
        return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 });
      }

      if (!claimResult || claimResult.length === 0) {
        return NextResponse.json({ error: 'Webhook claim failed' }, { status: 500 });
      }

      const { claimed, already_processed } = claimResult[0];

      if (already_processed) {
        return new NextResponse(null, { status: 200 });
      }

      if (!claimed) {
        // Another processor owns this event - return non-2xx
        return NextResponse.json({ error: 'Event already being processed' }, { status: 409 });
      }

      if (eventType === 'payment.failed') {
        const { data: failureResult, error: failureError } = await dbAdmin.rpc('record_payment_failure', {
          p_rzp_order_id: rzpOrderId!,
          p_rzp_payment_id: paymentId!,
          p_event_id: eventId,
        });

        if (failureError) {
          console.error('Record payment failure failed', { stage: 'FAILURE', code: failureError.code, message: failureError.message });
          await dbAdmin
            .from('razorpay_webhook_events')
            .update({ status: 'FAILED', processed_at: new Date().toISOString() })
            .eq('rzp_event_id', eventId);
          return NextResponse.json({ error: 'Failure processing failed' }, { status: 500 });
        }

        if (!failureResult || !failureResult.success) {
          await dbAdmin
            .from('razorpay_webhook_events')
            .update({ status: 'FAILED', processed_at: new Date().toISOString() })
            .eq('rzp_event_id', eventId);
          return NextResponse.json({ error: 'Failure processing failed' }, { status: 500 });
        }

        return new NextResponse(null, { status: 200 });
      }

      if (eventType === 'payment.captured') {
        const rzp = getRazorpayClient();
        let fetchedPayment;
        try {
          fetchedPayment = await rzp.payments.fetch(paymentId!);
        } catch (err) {
          console.error('Razorpay fetch failed', err);
          await dbAdmin
            .from('razorpay_webhook_events')
            .update({ status: 'FAILED', processed_at: new Date().toISOString() })
            .eq('rzp_event_id', eventId);
          return NextResponse.json({ error: 'Payment fetch failed' }, { status: 502 });
        }

        if (fetchedPayment.status !== 'captured' || !fetchedPayment.captured) {
          await dbAdmin
            .from('razorpay_webhook_events')
            .update({ status: 'FAILED', processed_at: new Date().toISOString() })
            .eq('rzp_event_id', eventId);
          return NextResponse.json({ error: 'Payment not captured' }, { status: 400 });
        }

        if (fetchedPayment.id !== paymentId!) {
          await dbAdmin
            .from('razorpay_webhook_events')
            .update({ status: 'FAILED', processed_at: new Date().toISOString() })
            .eq('rzp_event_id', eventId);
          return NextResponse.json({ error: 'Payment ID mismatch' }, { status: 400 });
        }

        if (fetchedPayment.order_id !== rzpOrderId!) {
          await dbAdmin
            .from('razorpay_webhook_events')
            .update({ status: 'FAILED', processed_at: new Date().toISOString() })
            .eq('rzp_event_id', eventId);
          return NextResponse.json({ error: 'Order ID mismatch' }, { status: 400 });
        }

        const authoritativeAmount = fetchedPayment.amount;
        const authoritativeCurrency = fetchedPayment.currency.toUpperCase();

        const { data: captureResult, error: captureError } = await dbAdmin.rpc('capture_payment_atomic', {
          p_rzp_order_id: rzpOrderId!,
          p_rzp_payment_id: paymentId!,
          p_amount: authoritativeAmount,
          p_currency: authoritativeCurrency,
          p_event_id: eventId,
        });

        if (captureError) {
          console.error('Capture payment failed', { stage: 'CAPTURE', code: captureError.code, message: captureError.message, details: captureError.details, hint: captureError.hint });
          await dbAdmin
            .from('razorpay_webhook_events')
            .update({ status: 'FAILED', processed_at: new Date().toISOString() })
            .eq('rzp_event_id', eventId);
          return NextResponse.json({ error: 'Capture processing failed' }, { status: 500 });
        }

        if (!captureResult) {
          await dbAdmin
            .from('razorpay_webhook_events')
            .update({ status: 'FAILED', processed_at: new Date().toISOString() })
            .eq('rzp_event_id', eventId);
          return NextResponse.json({ error: 'Capture processing failed' }, { status: 500 });
        }

        if (captureResult.success && captureResult.already_paid) {
          return new NextResponse(null, { status: 200 });
        }

        if (!captureResult.success) {
          await dbAdmin
            .from('razorpay_webhook_events')
            .update({ status: 'FAILED', processed_at: new Date().toISOString() })
            .eq('rzp_event_id', eventId);
          return NextResponse.json({ error: 'Validation failed' }, { status: 400 });
        }

        return new NextResponse(null, { status: 200 });
      }
    } else {
      // Ignore other event types - record and return 200
      const dbAdmin = getSupabaseAdmin();
      await dbAdmin
        .from('razorpay_webhook_events')
        .upsert(
          {
            rzp_event_id: eventId,
            event_type: event.event,
            status: 'PROCESSED',
            processed_at: new Date().toISOString(),
            sanitized_payload: { event_type: event.event },
          },
          { onConflict: 'rzp_event_id' }
        );
      return new NextResponse(null, { status: 200 });
    }

    return new NextResponse(null, { status: 200 });
  } catch (err) {
    console.error('Webhook processing error', err);
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 });
  }
}
