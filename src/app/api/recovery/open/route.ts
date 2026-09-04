import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { hashToken } from '@/lib/token';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { token } = body;

    // 1. Validate Token Format (64-char hex)
    if (!token || typeof token !== 'string' || !/^[0-9a-fA-F]{64}$/.test(token)) {
      return NextResponse.json({ error: 'Recovery link not found' }, { status: 404 });
    }

    const tokenHash = hashToken(token);
    const admin = getSupabaseAdmin();

    // 2. Call RPC
    const { data: rpcData, error: rpcError } = await admin.rpc('open_recovery_link', {
      p_recovery_token_hash: tokenHash
    });

    if (rpcError) {
      const err = rpcError.message;
      if (err.includes('Recovery link not found')) return NextResponse.json({ error: 'Recovery link not found' }, { status: 404 });
      if (err.includes('Recovery link expired')) return NextResponse.json({ error: 'Recovery link expired' }, { status: 410 });
      if (err.includes('Checkout already paid')) return NextResponse.json({ error: 'Checkout already paid' }, { status: 409 });
      if (err.includes('Invalid recovery state')) return NextResponse.json({ error: 'Recovery link is no longer active' }, { status: 409 });
      
      // Generic internal errors
      return NextResponse.json({ error: 'Unable to open recovery link' }, { status: 500 });
    }

    const rpcResult = Array.isArray(rpcData) ? rpcData[0] : rpcData;
    if (!rpcResult) return NextResponse.json({ error: 'Unable to open recovery link' }, { status: 500 });

    // 3. Fetch Checkout
    const { data: checkout, error: checkoutError } = await admin
      .from('checkouts')
      .select('id, status, total_amount_paise, created_at')
      .eq('id', rpcResult.checkout_id)
      .single();

    if (checkoutError || !checkout) {
      return NextResponse.json({ error: 'Unable to open recovery link' }, { status: 500 });
    }

    // 4. Post-RPC Paid Safety
    if (checkout.status === 'PAID') {
      return NextResponse.json({ error: 'Checkout already paid' }, { status: 409 });
    }

    // 5. Fetch Checkout Items
    const { data: items, error: itemsError } = await admin
      .from('checkout_items')
      .select('id, product_name_snapshot, unit_price_paise_snapshot, quantity, line_total_paise')
      .eq('checkout_id', checkout.id);

    if (itemsError) {
      return NextResponse.json({ error: 'Unable to open recovery link' }, { status: 500 });
    }

    // 6. Return Response
    return NextResponse.json({
      recovery: {
        status: rpcResult.case_status,
        opened_at: rpcResult.opened_at,
        expires_at: rpcResult.expires_at
      },
      checkout: {
        id: checkout.id,
        status: checkout.status,
        total_amount_paise: checkout.total_amount_paise,
        created_at: checkout.created_at
      },
      items: items.map(item => ({
        id: item.id,
        product_name: item.product_name_snapshot,
        unit_price_paise: item.unit_price_paise_snapshot,
        quantity: item.quantity,
        line_total_paise: item.line_total_paise
      }))
    });

  } catch {
    console.error('Recovery link open failed'); // Safe logging
    return NextResponse.json({ error: 'Unable to open recovery link' }, { status: 500 });
  }
}
