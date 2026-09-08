import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { verifyMerchantSession } from '@/lib/auth';
import { randomBytes } from 'crypto';
import { hashToken } from '@/lib/token';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const authHeader = req.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const token = authHeader.split(' ')[1];
  const admin = getSupabaseAdmin();

  const { isValid, code } = await verifyMerchantSession(admin, token);
  if (!isValid) {
    const error = code === 403 ? 'Forbidden' : 'Unauthorized';
    return NextResponse.json({ error }, { status: code || 401 });
  }

  // 1. Fetch case and proposal
  const { data: recoveryCase, error: caseError } = await admin
    .from('recovery_cases')
    .select(`
      id, checkout_id, status, created_at,
      recovery_proposals (id, proposed_channel, proposed_message)
    `)
    .eq('id', id)
    .single();

  if (caseError) {
    if (caseError.code === 'PGRST116') return NextResponse.json({ error: 'Case not found' }, { status: 404 });
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
  if (!recoveryCase) return NextResponse.json({ error: 'Case not found' }, { status: 404 });

  const proposal = Array.isArray(recoveryCase.recovery_proposals) 
    ? recoveryCase.recovery_proposals[0] 
    : recoveryCase.recovery_proposals;

  if (!proposal) return NextResponse.json({ error: 'No proposal found' }, { status: 409 });

  // 2. Idempotency Check & Status Verification
  if (recoveryCase.status === 'SENT') {
    const { data: outreach, error: outreachError } = await admin
      .from('recovery_outreach')
      .select('*')
      .eq('recovery_case_id', id)
      .maybeSingle();

    if (outreachError) return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    if (outreach) {
      return NextResponse.json({ status: 'SENT', already_sent: true });
    }
    // If we reach here, it's SENT but no outreach row found (unexpected)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }


  if (recoveryCase.status !== 'APPROVED') {
    return NextResponse.json({ error: 'Invalid state for outreach' }, { status: 409 });
  }

  // 3. Prepare generation
  const rawToken = randomBytes(32).toString('hex');
  const hashedToken = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  const recoveryUrl = `${baseUrl}/recover/${rawToken}`;
  const messageBody = proposal.proposed_message;

  // 4. Atomic RPC
  const { data: outreach, error: rpcError } = await admin.rpc('send_recovery_outreach', {
    p_case_id: id,
    p_channel: proposal.proposed_channel,
    p_message_body: messageBody,
    p_recovery_token_hash: hashedToken,
    p_expires_at: expiresAt.toISOString()
  });

  if (rpcError) {
    // Map RPC errors
    const err = rpcError.message;
    if (err.includes('Case not found')) return NextResponse.json({ error: 'Case not found' }, { status: 404 });
    if (err.includes('Invalid state for outreach')) return NextResponse.json({ error: 'Invalid state for outreach' }, { status: 409 });
    if (err.includes('No proposal found')) return NextResponse.json({ error: 'No proposal found' }, { status: 409 });
    if (err.includes('Channel mismatch')) return NextResponse.json({ error: 'Channel mismatch' }, { status: 409 });
    if (err.includes('Message body must contain')) return NextResponse.json({ error: 'Message body validation failed' }, { status: 409 });
    if (err.includes('Outreach state inconsistent')) return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    if (err.includes('Recovery link expiry must be in the future')) return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }

  return NextResponse.json({
    status: 'SENT',
    already_sent: false,
    outreach: {
      id: outreach.id,
      channel: outreach.channel,
      message_body: outreach.message_body,
      sent_at: outreach.sent_at,
      expires_at: outreach.expires_at,
      recovery_url: recoveryUrl
    }
  });
}
