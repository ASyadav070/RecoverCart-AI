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
  const { data: { user } } = await admin.auth.getUser(token);
  const merchantId = user?.id || process.env.MERCHANT_USER_ID;

  // Fetch recovery case and checkout
  const { data: recoveryCase, error: caseError } = await admin
    .from('recovery_cases')
    .select(`
      id, checkout_id, status, revenue_at_risk_paise, created_at,
      checkouts (
        id, status, customer_email, customer_phone, preferred_channel, consent_given, total_amount_paise, created_at
      ),
      recovery_proposals (
        action, strategy, merchant_rationale, proposed_channel, proposed_message, discount_recommended, discount_type, discount_value
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
    { data: audit, error: auditError },
    { data: policy, error: policyError },
    { data: outreach, error: outreachError }
  ] = await Promise.all([
    admin.from('checkout_items').select('id, product_id, product_name_snapshot, unit_price_paise_snapshot, quantity, line_total_paise').eq('checkout_id', checkoutId),
    admin.from('payment_orders').select('id, rzp_order_id, status, amount_paise').eq('checkout_id', checkoutId),
    admin.from('recovery_audit_events').select('id, event_type, payload, created_at').eq('checkout_id', checkoutId).order('created_at', { ascending: true }),
    admin.from('recovery_policies').select('*').eq('merchant_id', merchantId).maybeSingle(),
    admin.from('recovery_outreach').select('id, channel, message_body, sent_at, expires_at').eq('recovery_case_id', id).maybeSingle()
  ]);

  if (itemsError || ordersError || auditError || policyError || outreachError) {
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

  // Derive inventory status
  let inventoryStatus = 'UNKNOWN';
  if (items && policy) {
    const productIds = items.map(item => item.product_id);
    const { data: products, error: productsError } = await admin.from('products').select('id, stock').in('id', productIds);
    if (productsError) return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    const productMap = new Map(products?.map(p => [p.id, p.stock]));
    const itemStatuses = items.map(item => {
      const stock = productMap.get(item.product_id);
      if (stock === undefined) return 'UNKNOWN';
      return stock <= policy.low_stock_threshold ? 'LOW_STOCK' : 'NORMAL';
    });
    inventoryStatus = itemStatuses.includes('LOW_STOCK') ? 'LOW_STOCK' :
                      itemStatuses.includes('UNKNOWN') ? 'UNKNOWN' : 'NORMAL';
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
    proposal: recoveryCase.recovery_proposals ? (Array.isArray(recoveryCase.recovery_proposals) ? recoveryCase.recovery_proposals[0] : recoveryCase.recovery_proposals) : null,
    policy: policy,
    inventory_status: inventoryStatus,
    items: items || [],
    payments: {
      orders: paymentOrders || [],
      attempts: attempts
    },
    audit: audit || [],
    outreach: outreach || null
  });
}
