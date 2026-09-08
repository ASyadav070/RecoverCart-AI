'use client';
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import Link from 'next/link';

interface RecentRecovery {
  recovery_case_id: string;
  checkout_id: string;
  amount_paise: number;
  recovered_at: string;
}

interface RecoveryMetrics {
  revenue_at_risk_paise: number;
  recovered_revenue_paise: number;
  outstanding_revenue_at_risk_paise: number;
  total_recovery_cases: number;
  recovered_cases: number;
  recovery_rate_percent: number;
  recent_recoveries: RecentRecovery[];
}

const formatCurrency = (paise: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(paise / 100);

export default function MerchantPage() {
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [metrics, setMetrics] = useState<RecoveryMetrics | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchMetrics = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const response = await fetch('/api/recovery/metrics', {
        headers: { 'Authorization': `Bearer ${session.access_token}` },
      });
      if (!response.ok) throw new Error('Unable to load recovery metrics.');
      const data = await response.json();
      setMetrics(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to load recovery metrics.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchMetrics();
  }, [fetchMetrics]);

  const runScan = async () => {
    setScanning(true);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');
      const response = await fetch('/api/recovery/scan', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${session.access_token}` },
      });
      if (!response.ok) throw new Error('Scan failed');
      await fetchMetrics(); // Refresh metrics after successful scan
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Scan failed');
    } finally {
      setScanning(false);
    }
  };

  return (
    <div className="p-8 max-w-5xl mx-auto bg-zinc-950 text-zinc-100 min-h-screen">
      <header className="mb-8 border-b border-zinc-800 pb-6 flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">Merchant Recovery Portal</h1>
          <p className="text-zinc-400 mt-2">Monitor revenue at risk and measure verified recovery performance.</p>
        </div>
        <div className="flex gap-4">
          <Link href="/merchant/cases" className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 rounded text-sm font-medium">View Recovery Cases</Link>
          <button
            onClick={runScan}
            disabled={scanning}
            className="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700 transition-colors disabled:opacity-50"
          >
            {scanning ? 'Running scan...' : 'Run Abandonment Scan'}
          </button>
        </div>
      </header>

      {error && <div className="p-4 bg-red-900/20 border border-red-800 text-red-200 rounded mb-6">{error}</div>}

      {loading && !metrics ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1,2,3,4,5,6].map(i => <div key={i} className="h-32 bg-zinc-800 rounded animate-pulse" />)}
        </div>
      ) : metrics ? (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-12">
            <div className="p-6 bg-zinc-900 border border-zinc-800 rounded-lg">
              <p className="text-zinc-400 text-sm mb-1">Recovered Revenue</p>
              <p className="text-3xl font-bold text-emerald-400">{formatCurrency(metrics.recovered_revenue_paise)}</p>
            </div>
            <div className="p-6 bg-zinc-900 border border-zinc-800 rounded-lg">
              <p className="text-zinc-400 text-sm mb-1">Revenue at Risk</p>
              <p className="text-2xl font-bold text-zinc-100">{formatCurrency(metrics.revenue_at_risk_paise)}</p>
            </div>
            <div className="p-6 bg-zinc-900 border border-zinc-800 rounded-lg">
              <p className="text-zinc-400 text-sm mb-1">Outstanding Revenue</p>
              <p className="text-2xl font-bold text-zinc-100">{formatCurrency(metrics.outstanding_revenue_at_risk_paise)}</p>
            </div>
            <div className="p-6 bg-zinc-900 border border-zinc-800 rounded-lg">
              <p className="text-zinc-400 text-sm mb-1">Recovery Rate</p>
              <p className="text-2xl font-bold text-indigo-400">{metrics.recovery_rate_percent.toFixed(2)}%</p>
            </div>
            <div className="p-6 bg-zinc-900 border border-zinc-800 rounded-lg">
              <p className="text-zinc-400 text-sm mb-1">Recovered Cases</p>
              <p className="text-2xl font-bold text-zinc-100">{metrics.recovered_cases}</p>
            </div>
            <div className="p-6 bg-zinc-900 border border-zinc-800 rounded-lg">
              <p className="text-zinc-400 text-sm mb-1">Total Recovery Cases</p>
              <p className="text-2xl font-bold text-zinc-100">{metrics.total_recovery_cases}</p>
            </div>
          </div>

          <section>
            <h2 className="text-xl font-bold mb-4">Recent Recoveries</h2>
            {metrics.recent_recoveries.length > 0 ? (
              <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
                <table className="w-full text-left text-sm">
                  <thead className="bg-zinc-800 text-zinc-400">
                    <tr>
                      <th className="p-4">Case ID</th>
                      <th className="p-4">Amount</th>
                      <th className="p-4">Recovered At</th>
                      <th className="p-4">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800">
                    {metrics.recent_recoveries.map(r => (
                      <tr key={r.recovery_case_id}>
                        <td className="p-4 text-zinc-400 font-mono text-xs">{r.recovery_case_id.slice(0, 8)}...</td>
                        <td className="p-4 font-medium text-emerald-400">{formatCurrency(r.amount_paise)}</td>
                        <td className="p-4 text-zinc-300">{new Date(r.recovered_at).toLocaleDateString()}</td>
                        <td className="p-4">
                          <Link href={`/merchant/cases/${r.recovery_case_id}`} className="text-indigo-400 hover:text-indigo-300">View</Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="p-8 border border-dashed border-zinc-800 rounded-lg text-center text-zinc-500">
                No recovered revenue yet.
              </div>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}