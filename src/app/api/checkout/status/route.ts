import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import crypto from 'crypto';

export async function POST(request: Request) {
    try {
        const { token } = await request.json();
        const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
        
        const { data: checkout } = await getSupabaseAdmin()
            .from('checkouts')
            .select('status')
            .eq('session_token_hash', tokenHash)
            .single();

        return NextResponse.json({ status: checkout?.status });
    } catch {
        return NextResponse.json({ error: 'Status check failed' }, { status: 500 });
    }
}
