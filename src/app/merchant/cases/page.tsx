'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import Link from 'next/link';
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RecoveryStatusBadge } from '@/components/recovery/RecoveryStatusBadge';
import { Alert, AlertDescription } from '@/components/ui/alert';

interface RecoveryCase {
  id: string;
  status: string;
  customer_email: string;
  amount_at_risk: number;
  created_at: string;
}

export default function MerchantCasesPage() {
  const [cases, setCases] = useState<RecoveryCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    async function fetchData() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        router.push('/merchant/login');
        return;
      }

      try {
        const response = await fetch('/api/recovery/cases', {
          headers: {
            'Authorization': `Bearer ${session.access_token}`
          }
        });

        if (response.status === 401) {
          router.push('/merchant/login');
          return;
        }

        if (response.status === 403) {
          setError('Access Denied: You do not have permission to view this page.');
          setLoading(false);
          return;
        }

        if (!response.ok) {
          throw new Error('Failed to fetch cases');
        }

        const data = await response.json();
        setCases(data.cases);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'An error occurred');
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [router]);

  if (loading) return <div className="text-zinc-400 p-8">Loading...</div>;
  if (error) return <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>;

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold text-zinc-100">Recovery Cases</h1>
          <p className="text-zinc-500 text-sm mt-1">Review detected recovery opportunities and track their current recovery state.</p>
        </div>
        <Link href="/merchant" className={buttonVariants({ variant: "outline", size: "sm" })}>
          Back to Dashboard
        </Link>
      </div>
      {cases.length === 0 ? (
        <div className="text-center py-12 border border-dashed border-zinc-800 rounded-lg">
          <p className="text-zinc-500">No recovery cases yet.</p>
          <p className="text-zinc-600 text-sm mt-1">Abandoned checkouts detected by RecoverCart AI will appear here.</p>
        </div>
      ) : (
        <div className="rounded-md border border-zinc-800 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent border-zinc-800">
                <TableHead>Customer</TableHead>
                <TableHead>Amount (INR)</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {cases.map((c) => (
                <TableRow key={c.id} className="border-zinc-800">
                  <TableCell className="font-medium">{c.customer_email}</TableCell>
                  <TableCell>{(c.amount_at_risk / 100).toLocaleString('en-IN', { style: 'currency', currency: 'INR' })}</TableCell>
                  <TableCell>
                    <RecoveryStatusBadge status={c.status} />
                  </TableCell>
                  <TableCell className="text-zinc-400">{new Date(c.created_at).toLocaleDateString()}</TableCell>
                  <TableCell className="text-right">
                    <Link href={`/merchant/cases/${c.id}`} className={cn(buttonVariants({ variant: "outline", size: "sm" }), "text-blue-300 border-blue-500/30 bg-blue-500/10 hover:bg-blue-500/20 hover:text-blue-200")}>
                      View Case
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
