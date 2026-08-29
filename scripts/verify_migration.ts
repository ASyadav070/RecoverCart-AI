import { createClient } from '@supabase/supabase-js';

async function verify() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  if (!supabaseUrl || !supabaseKey) {
    console.error('Environment variables missing');
    return;
  }
  const supabase = createClient(supabaseUrl, supabaseKey);

  console.log('--- Verifying Schema ---');
  
  // 1. Check Tables
  const { error: tableError } = await supabase
    .from('recovery_cases')
    .select('*', { count: 'exact', head: true });

  if (tableError) {
    console.error('FAIL: recovery_cases table missing or inaccessible:', tableError.message);
  } else {
    console.log('PASS: recovery_cases table exists');
  }

  const { error: auditError } = await supabase
    .from('recovery_audit_events')
    .select('*', { count: 'exact', head: true });

  if (auditError) {
    console.error('FAIL: recovery_audit_events table missing or inaccessible:', auditError.message);
  } else {
    console.log('PASS: recovery_audit_events table exists');
  }

  // 2. Test Abandonment Logic
  console.log('\n--- Testing Logic ---');
  
  const { data: checkout, error: coErr } = await supabase
    .from('checkouts')
    .insert({
      status: 'STARTED',
      total_amount_paise: 1000,
      created_at: new Date(Date.now() - 70000).toISOString()
    })
    .select()
    .single();

  if (coErr) {
    console.error('FAIL: Could not create test checkout:', coErr.message);
    return;
  }
  console.log('PASS: Test checkout created');

  const { data: _scanResult, error: scanErr } = await supabase.rpc('scan_and_abandon_checkouts', { p_threshold_seconds: 60 });

  if (scanErr) {
    console.error('FAIL: scan_and_abandon_checkouts failed:', scanErr.message);
  } else {
    console.log('PASS: scan_and_abandon_checkouts executed');
    console.log('Scan Result:', _scanResult);
    
    // Check if case was created
    const { data: cases } = await supabase.from('recovery_cases').select('*').eq('checkout_id', checkout.id);
    if (cases && cases.length === 1 && cases[0].revenue_at_risk_paise === 1000) {
      console.log('PASS: Recovery case created and amount matches');
    } else {
      console.error('FAIL: Recovery case issue (count/amount mismatch)');
    }
  }

  // Cleanup
  await supabase.from('recovery_cases').delete().eq('checkout_id', checkout.id);
  await supabase.from('checkouts').delete().eq('id', checkout.id);
}

verify().catch(console.error);
