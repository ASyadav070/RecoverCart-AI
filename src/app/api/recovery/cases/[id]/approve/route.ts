import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: recoveryCaseId } = await params;
  const authHeader = req.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = getSupabaseAdmin();
  const { data: { user }, error: authError } = await admin.auth.getUser(authHeader.replace('Bearer ', ''));
  if (authError || !user || user.id !== process.env.MERCHANT_USER_ID) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Fetch case to check eligibility
  const { data: recoveryCase, error: caseErr } = await admin
    .from('recovery_cases')
    .select('id, checkout_id, created_at, status')
    .eq('id', recoveryCaseId)
    .single();

  if (caseErr) return NextResponse.json({ error: 'Case not found' }, { status: 404 });


  const { error: rpcErr } = await admin.rpc('approve_recovery_proposal', { p_case_id: recoveryCaseId });

  if (rpcErr) {
    if (rpcErr.message.includes('Case not found')) return NextResponse.json({ error: 'Case not found' }, { status: 404 });
    if (rpcErr.message.includes('Invalid state') || rpcErr.message.includes('No proposal found')) return NextResponse.json({ error: 'Invalid state for approval' }, { status: 409 });
    return NextResponse.json({ error: 'Database error' }, { status: 500 });
  }

  return NextResponse.json({ status: 'APPROVED' });
}
