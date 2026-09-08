import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { verifyMerchantSession } from '@/lib/auth';

export async function POST(request: Request) {
  const admin = getSupabaseAdmin();
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const token = authHeader.replace('Bearer ', '').trim();
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { isValid, code } = await verifyMerchantSession(admin, token);

  if (!isValid) return NextResponse.json({ error: code === 403 ? 'Forbidden' : 'Unauthorized' }, { status: code || 401 });

  // Validate abandonment threshold
  const thresholdSeconds = Number(process.env.ABANDONMENT_THRESHOLD_SECONDS ?? '60');
  if (!Number.isInteger(thresholdSeconds) || thresholdSeconds <= 0) {
    return NextResponse.json({ error: 'Configuration Error' }, { status: 500 });
  }

  const { data, error } = await admin.rpc(
    'scan_and_abandon_checkouts',
    { p_threshold_seconds: thresholdSeconds }
  );

  if (error) {
    return NextResponse.json(
      { error: 'Scan failed' },
      { status: 500 }
    );
  }

  // Trigger lifecycle reconciliation
  await admin.rpc('reconcile_recovery_lifecycle');

  return NextResponse.json({ success: true, count: data?.length || 0 });
}