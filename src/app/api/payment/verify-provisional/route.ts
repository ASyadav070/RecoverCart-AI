import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import crypto from 'crypto';
import { z } from 'zod';

export async function POST(request: Request) {
    try {
        const bodyText = await request.text();
        const body = JSON.parse(bodyText);
        
        const schema = z.object({
            token: z.string(),
            order_id: z.string()
        });
        const parsed = schema.safeParse(body);
        if (!parsed.success) {
            return NextResponse.json({ error: 'Invalid input' }, { status: 400 });
        }
        
        const { token, order_id } = parsed.data;
        const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
        const dbAdmin = getSupabaseAdmin();
        
        const { data: checkout, error: checkoutError } = await dbAdmin
            .from('checkouts')
            .select('rzp_order_id')
            .eq('session_token_hash', tokenHash)
            .single();
        
        if (checkoutError || !checkout) {
            return NextResponse.json({ error: 'Invalid token' }, { status: 400 });
        }
        
        const signature = request.headers.get('x-razorpay-signature');
        if (!signature || !process.env.RAZORPAY_WEBHOOK_SECRET) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
        
        const expectedSignature = crypto
            .createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET)
            .update(bodyText)
            .digest('hex');
            
        if (signature !== expectedSignature) {
            return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
        }
        
        return NextResponse.json({ provisional: true, order_id: order_id });
    } catch {
        return NextResponse.json({ error: 'Verification failed' }, { status: 500 });
    }
}
