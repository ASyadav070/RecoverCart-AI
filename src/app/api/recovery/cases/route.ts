import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { verifyMerchantSession } from '@/lib/auth';

export async function GET(req: NextRequest) {
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

  const { data: cases, error } = await admin
    .from('recovery_cases')
    .select(`
      id,
      status,
      revenue_at_risk_paise,
      created_at,
      checkouts (
        customer_email
      )
    `)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error fetching recovery cases:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
  // console.log('Recovery cases raw:', JSON.stringify(cases, null, 2));
  const formattedCases = cases.map((c: {
    id: string;
    status: string;
    revenue_at_risk_paise: number;
    created_at: string;
    checkouts:
    | { customer_email: string | null }
    | { customer_email: string | null }[]
    | null;
  }) => {
    const checkout = Array.isArray(c.checkouts)
      ? c.checkouts[0]
      : c.checkouts;

    return {
      id: c.id,
      status: c.status,
      customer_email: checkout?.customer_email || 'N/A',
      amount_at_risk: c.revenue_at_risk_paise,
      created_at: c.created_at,
    };
  });

  return NextResponse.json({ cases: formattedCases });
}
