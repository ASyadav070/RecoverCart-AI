import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { hashToken } from '@/lib/token';

export async function POST(request: Request) {
    try {
        const { token } = await request.json();
        const tokenHash = hashToken(token);
        
        const { data: session } = await getSupabaseAdmin()
            .from('checkout_sessions')
            .select('checkout_id')
            .eq('session_token_hash', tokenHash)
            .single();
            
        if (!session) return NextResponse.json({ error: 'Invalid token' }, { status: 400 });

        const { data: checkout } = await getSupabaseAdmin()
            .from('checkouts')
            .select('status')
            .eq('id', session.checkout_id)
            .single();

        return NextResponse.json({ status: checkout?.status });
    } catch {
        return NextResponse.json({ error: 'Status check failed' }, { status: 500 });
    }
}
