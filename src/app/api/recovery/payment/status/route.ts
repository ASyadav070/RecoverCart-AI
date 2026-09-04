import { NextResponse } from 'next/server';
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

        // 1. Resolve recovery outreach
        const { data: outreach, error: outreachError } = await dbAdmin
            .from('recovery_outreach')
            .select(`
                expires_at,
                recovery_case:recovery_cases(status, checkout_id, checkout:checkouts(status))
            `)
            .eq('recovery_token_hash', tokenHash)
            .single();

        if (outreachError || !outreach || !outreach.recovery_case) {
            return NextResponse.json({ error: 'Recovery link not found' }, { status: 404 });
        }

        // The recovery_case might be returned as an array or a single object depending on Supabase SDK
        const recoveryCase = Array.isArray(outreach.recovery_case) 
            ? (outreach.recovery_case.length > 0 ? outreach.recovery_case[0] : null) 
            : outreach.recovery_case as { status: string, checkout: { status: string }[] | { status: string } } | null;
        const checkout = Array.isArray(recoveryCase?.checkout) ? recoveryCase?.checkout[0] : recoveryCase?.checkout;

        if (!recoveryCase || !checkout) {
            return NextResponse.json({ error: 'Unable to resolve recovery state' }, { status: 500 });
        }

        // 2. Evaluate status (Authoritative)
        const isPaid = checkout.status === 'PAID';
        const isExpired = new Date(outreach.expires_at) < new Date();

        // Expired but not complete -> 410
        if (isExpired && !isPaid && recoveryCase.status !== 'RECOVERED') {
            return NextResponse.json({ error: 'Recovery link expired' }, { status: 410 });
        }

        return NextResponse.json({
            payment_status: isPaid ? 'PAID' : 'PENDING',
            recovery_status: recoveryCase.status
        });

    } catch {
        console.error('Recovery status check failed', { stage: 'STATUS_LOOKUP' });
        return NextResponse.json({ error: 'Unable to resolve recovery state' }, { status: 500 });
    }
}
