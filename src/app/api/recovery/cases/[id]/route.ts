import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { verifyMerchantSession } from '@/lib/auth';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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

  // Fetch recovery case and checkout
  const { data: recoveryCase, error: caseError } = await admin
    .from('recovery_cases')
    .select(`
      id, checkout_id, status, revenue_at_risk_paise, created_at,
      checkouts (
        id, status, customer_email, customer_phone, preferred_channel, consent_given, total_amount_paise, created_at
      )
    `)
    .eq('id', id)
    .single();

  if (caseError) {
    if (caseError.code === 'PGRST116') return NextResponse.json({ error: 'Not Found' }, { status: 404 });
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
  if (!recoveryCase) return NextResponse.json({ error: 'Not Found' }, { status: 404 });

  const checkoutId = recoveryCase.checkout_id;

  // Fetch related data
  const [
    { data: items, error: itemsError },
    { data: paymentOrders, error: ordersError },
    { data: audit, error: auditError }
  ] = await Promise.all([
    admin.from('checkout_items').select('id, product_id, product_name_snapshot, unit_price_paise_snapshot, quantity, line_total_paise').eq('checkout_id', checkoutId),
    admin.from('payment_orders').select('id, rzp_order_id, status, amount_paise').eq('checkout_id', checkoutId),
    admin.from('recovery_audit_events').select('id, event_type, payload, created_at').eq('checkout_id', checkoutId).order('created_at', { ascending: true })
  ]);

  if (itemsError || ordersError || auditError) {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }

  // Fetch payment attempts for orders
  let attempts: { id: string; payment_order_id: string; rzp_payment_id: string; status: string; failure_code: string | null }[] = [];
  if (paymentOrders && paymentOrders.length > 0) {
    const orderIds = paymentOrders.map((o: { id: string }) => o.id);
    const { data: fetchedAttempts, error: attemptsError } = await admin
      .from('payment_attempts')
      .select('id, payment_order_id, rzp_payment_id, status, failure_code')
      .in('payment_order_id', orderIds);
    if (attemptsError) return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    attempts = fetchedAttempts || [];
  }

  return NextResponse.json({
    case: {
      id: recoveryCase.id,
      checkout_id: recoveryCase.checkout_id,
      status: recoveryCase.status,
      revenue_at_risk_paise: recoveryCase.revenue_at_risk_paise,
      created_at: recoveryCase.created_at
    },
    checkout: recoveryCase.checkouts,
    items: items || [],
    payments: {
      orders: paymentOrders || [],
      attempts: attempts
    },
    audit: audit || []
  });
}
