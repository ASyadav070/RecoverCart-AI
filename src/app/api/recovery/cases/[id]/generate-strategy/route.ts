import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { generateRecoveryProposal } from '@/lib/gemini';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: recoveryCaseId } = await params;
  const authHeader = req.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = getSupabaseAdmin();
  const { data: { user }, error: authError } = await admin.auth.getUser(authHeader.replace('Bearer ', ''));
  if (authError || !user || user.id !== process.env.MERCHANT_USER_ID) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const merchantId = user.id;

  // 1. Fetch Recovery Case + Context
  const { data: recoveryCase, error: caseError } = await admin
    .from('recovery_cases')
    .select(`
      id, status, revenue_at_risk_paise, checkout_id, created_at,
      checkouts (
        id, preferred_channel, consent_given, total_amount_paise,
        checkout_items (product_id, product_name_snapshot, quantity, unit_price_paise_snapshot, line_total_paise),
        payment_orders (status, payment_attempts (status, failure_code))
      )
    `)
    .eq('id', recoveryCaseId)
    .maybeSingle();

  if (caseError) return NextResponse.json({ error: 'Database error' }, { status: 500 });
  if (!recoveryCase) return NextResponse.json({ error: 'Recovery case not found' }, { status: 404 });
  
  
  const checkoutRelation = recoveryCase.checkouts;
  const checkout = Array.isArray(checkoutRelation) ? checkoutRelation[0] : checkoutRelation;
  if (!checkout) return NextResponse.json({ error: 'Checkout context missing' }, { status: 500 });

  // 2. Fetch Relevant Audit Events & Policy
  const [
    { data: auditEvents, error: auditReadErr },
    { data: policy, error: policyErr }
  ] = await Promise.all([
    admin.from('recovery_audit_events').select('event_type').eq('checkout_id', checkout.id).order('created_at', { ascending: false }).limit(10),
    admin.from('recovery_policies').select('*').eq('merchant_id', merchantId).maybeSingle()
  ]);

  if (auditReadErr || policyErr) return NextResponse.json({ error: 'Database error' }, { status: 500 });
  if (!policy) return NextResponse.json({ error: 'Merchant policy not found' }, { status: 500 });

  // 3. Derive Signals & Allowed Actions
  const paymentAttempts = checkout.payment_orders.flatMap(po => po.payment_attempts);
  const failureCount = paymentAttempts.filter(pa => pa.status === 'FAILED').length;
  
  const productIds = checkout.checkout_items.map(item => item.product_id);
  const { data: products, error: productErr } = await admin
    .from('products')
    .select('id, stock')
    .in('id', productIds);

  if (productErr) return NextResponse.json({ error: 'Database error' }, { status: 500 });

  const productMap = new Map(products?.map(p => [p.id, p.stock]));
  const itemStatuses = checkout.checkout_items.map(item => {
    const stock = productMap.get(item.product_id);
    if (stock === undefined) return 'UNKNOWN';
    return stock <= policy.low_stock_threshold ? 'LOW_STOCK' : 'NORMAL';
  });

  const inventoryStatus = itemStatuses.includes('LOW_STOCK') ? 'LOW_STOCK' : 
                          itemStatuses.includes('UNKNOWN') ? 'UNKNOWN' : 'NORMAL';

  const allowedActions = [
    failureCount === 0 ? 'CART_REMINDER' : 'PAYMENT_RETRY',
    ...(failureCount >= 1 ? ['PAYMENT_ASSISTANCE'] : []),
    'STOP_RECOVERY',
    'ESCALATE'
  ];

  if (policy.discounts_allowed && checkout.total_amount_paise >= policy.high_value_threshold_paise) {
    allowedActions.push('INCENTIVE_RECOVERY');
  }

  // 1.5 Claim status
  const { data: originalStatus, error: claimErr } = await admin.rpc('claim_recovery_generation', { p_case_id: recoveryCaseId });
  if (claimErr) {
    if (claimErr.message.includes('Case not found')) return NextResponse.json({ error: 'Case not found' }, { status: 404 });
    if (claimErr.message.includes('Invalid state')) return NextResponse.json({ error: 'Case ineligible for generation' }, { status: 409 });
    return NextResponse.json({ error: 'Database error' }, { status: 500 });
  }

  const rollbackGeneration = async () => {
    await admin.rpc('fail_recovery_generation', { p_case_id: recoveryCaseId, p_original_status: originalStatus });
  };

  try {
    // 4. Generate
    const minimizedContext = {
      revenue_at_risk_paise: recoveryCase.revenue_at_risk_paise,
      checkout: {
        preferred_channel: checkout.preferred_channel,
        consent_given: checkout.consent_given,
        total_amount_paise: checkout.total_amount_paise,
        items: checkout.checkout_items.map((i: { product_name_snapshot: string, quantity: number, unit_price_paise_snapshot: number, line_total_paise: number }) => ({
          product_name: i.product_name_snapshot,
          quantity: i.quantity,
          unit_price_paise: i.unit_price_paise_snapshot,
          line_total_paise: i.line_total_paise,
        })),
      },
      payments: {
        orders: checkout.payment_orders.map((po: { status: string, payment_attempts: { status: string, failure_code: string | null }[] }) => ({
          status: po.status,
          attempts: po.payment_attempts.map((pa: { status: string, failure_code: string | null }) => ({ status: pa.status, failure_code: pa.failure_code }))
        }))
      },
      recent_events: auditEvents?.map(e => e.event_type)
    };

    const proposal = await generateRecoveryProposal({
      ...minimizedContext,
      allowed_actions: allowedActions,
      inventory_status: inventoryStatus
    });

    if (!proposal) {
      await rollbackGeneration();
      return NextResponse.json({ error: 'AI generation failed' }, { status: 502 });
    }

    // 5. Validation
    const { action, discount } = proposal.proposal;
    if (!allowedActions.includes(action)) {
      await rollbackGeneration();
      return NextResponse.json({ error: 'AI generation failed' }, { status: 502 });
    }
    
    if (action === 'INCENTIVE_RECOVERY') {
      if (!policy.discounts_allowed || checkout.total_amount_paise < policy.high_value_threshold_paise) {
        await rollbackGeneration();
        return NextResponse.json({ error: 'AI generation failed' }, { status: 502 });
      }
      if (!discount.recommended || discount.type !== 'percentage' || discount.value === null || discount.value <= 0 || discount.value > policy.max_discount_percentage) {
        await rollbackGeneration();
        return NextResponse.json({ error: 'AI generation failed' }, { status: 502 });
      }
    } else {
      if (discount.recommended || discount.type !== null || discount.value !== null) {
        await rollbackGeneration();
        return NextResponse.json({ error: 'AI generation failed' }, { status: 502 });
      }
    }

    const proposalData = {
      action: proposal.proposal.action,
      strategy: proposal.proposal.strategy,
      merchant_rationale: proposal.proposal.merchant_rationale,
      proposed_channel: proposal.proposal.proposed_channel,
      proposed_message: proposal.proposal.proposed_message,
      discount: {
        recommended: proposal.proposal.discount.recommended,
        type: proposal.proposal.discount.type,
        value: proposal.proposal.discount.value
      },
      gemini_metadata: { model: proposal.model, fallback_attempt: proposal.attempt }
    };


    const { error: finalizeErr } = await admin.rpc('finalize_recovery_generation', {
      p_case_id: recoveryCaseId,
      p_proposal_data: proposalData
    });

    if (finalizeErr) {
      await rollbackGeneration();
      return NextResponse.json({ error: 'Database error' }, { status: 500 });
    }

    return NextResponse.json({ proposal: { ...proposal.proposal, recovery_case_id: recoveryCaseId } });
  } catch {
    console.error('Generation flow failed', {
      category: 'generation_flow_failure',
    });
    await rollbackGeneration();
    return NextResponse.json({ error: 'Database error' }, { status: 500 });
  }
}
