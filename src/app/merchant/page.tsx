'use client';
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import Link from 'next/link';

import { Button, buttonVariants } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { MetricCard } from "@/components/merchant/MetricCard";

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
    <div>
      <header className="mb-8 border-b border-zinc-800 pb-6 flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">Merchant Recovery Portal</h1>
          <p className="text-zinc-400 mt-2">Monitor revenue at risk and measure verified recovery performance.</p>
        </div>
        <div className="flex gap-4">
          <Link
            href="/merchant/cases"
            className={`${buttonVariants({ variant: "outline" })} bg-zinc-800 text-zinc-100 hover:bg-zinc-700 hover:text-white border-zinc-700`}
          >
            View Recovery Cases
          </Link>
          <Button
            onClick={runScan}
            disabled={scanning}
          >
            {scanning ? 'Scanning...' : 'Run Abandonment Scan'}
          </Button>
        </div>
      </header>

      {error && (
        <Alert variant="destructive" className="mb-6">
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {loading && !metrics ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3, 4, 5, 6].map(i => <div key={i} className="h-32 bg-zinc-900 border border-zinc-800 rounded-lg animate-pulse" />)}
        </div>
      ) : metrics ? (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-12">
            <MetricCard
              title="Recovered Revenue"
              value={formatCurrency(metrics.recovered_revenue_paise)}
              variant="success"
            />
            <MetricCard
              title="Revenue at Risk"
              value={formatCurrency(metrics.revenue_at_risk_paise)}
            />
            <MetricCard
              title="Outstanding Revenue"
              value={formatCurrency(metrics.outstanding_revenue_at_risk_paise)}
            />
            <MetricCard
              title="Recovery Rate"
              value={`${metrics.recovery_rate_percent.toFixed(2)}%`}
              variant="brand"
            />
            <MetricCard
              title="Recovered Cases"
              value={metrics.recovered_cases}
            />
            <MetricCard
              title="Total Recovery Cases"
              value={metrics.total_recovery_cases}
            />
          </div>

          <section>
            <h2 className="text-xl font-bold mb-4">Recent Recoveries</h2>
            {metrics.recent_recoveries.length > 0 ? (
              <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-x-auto">
                <Table>
                  <TableHeader className="bg-zinc-950/50">
                    <TableRow className="border-zinc-800 hover:bg-transparent">
                      <TableHead className="text-zinc-400">Case ID</TableHead>
                      <TableHead className="text-zinc-400">Amount</TableHead>
                      <TableHead className="text-zinc-400">Recovered At</TableHead>
                      <TableHead className="text-zinc-400">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {metrics.recent_recoveries.map(r => (
                      <TableRow key={r.recovery_case_id} className="border-zinc-800 hover:bg-zinc-800/50">
                        <TableCell className="text-zinc-400 font-mono text-xs">{r.recovery_case_id.slice(0, 8)}...</TableCell>
                        <TableCell className="font-medium text-emerald-400">{formatCurrency(r.amount_paise)}</TableCell>
                        <TableCell className="text-zinc-300">{new Date(r.recovered_at).toLocaleDateString()}</TableCell>
                        <TableCell>
                          <Link
                            href={`/merchant/cases/${r.recovery_case_id}`}
                            className={buttonVariants({ variant: "link", size: "sm" })}
                          >
                            View
                          </Link>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
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