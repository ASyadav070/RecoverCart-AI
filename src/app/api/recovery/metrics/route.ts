import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { verifyMerchantSession } from '@/lib/auth';

export async function GET(request: Request) {
  const admin = getSupabaseAdmin();
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const token = authHeader.replace('Bearer ', '').trim();
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { isValid, code } = await verifyMerchantSession(admin, token);
  if (!isValid) {
    return NextResponse.json(
      { error: code === 403 ? 'Forbidden' : 'Unauthorized' }, 
      { status: code || 401 }
    );
  }

  const { data, error } = await admin.rpc('get_recovery_metrics');

  if (error) {
    console.error('Metrics RPC failed:', error.message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }

  const result = (data && Array.isArray(data) && data.length > 0) ? data[0] : null;

  if (!result) {
    return NextResponse.json({
      revenue_at_risk_paise: 0,
      recovered_revenue_paise: 0,
      outstanding_revenue_at_risk_paise: 0,
      total_recovery_cases: 0,
      recovered_cases: 0,
      recovery_rate_percent: 0,
      recent_recoveries: []
    });
  }

  const safeNumber = (val: unknown) => {
    const num = Number(val);
    return Number.isFinite(num) ? num : 0;
  };

  const safeInt = (val: unknown) => {
    const num = Number(val);
    return Number.isSafeInteger(num) ? num : 0;
  };

  return NextResponse.json({
    revenue_at_risk_paise: safeInt(result.revenue_at_risk_paise),
    recovered_revenue_paise: safeInt(result.recovered_revenue_paise),
    outstanding_revenue_at_risk_paise: safeInt(result.outstanding_revenue_at_risk_paise),
    total_recovery_cases: safeInt(result.total_recovery_cases),
    recovered_cases: safeInt(result.recovered_cases),
    recovery_rate_percent: safeNumber(result.recovery_rate_percent),
    recent_recoveries: Array.isArray(result.recent_recoveries) ? result.recent_recoveries : []
  });
}
