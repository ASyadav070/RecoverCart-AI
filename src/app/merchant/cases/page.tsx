'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import Link from 'next/link';

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

  if (loading) return <div className="p-8">Loading...</div>;
  if (error) return <div className="p-8 text-red-600">Error: {error}</div>;

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Recovery Cases</h1>
      {cases.length === 0 ? (
        <p>No recovery cases found.</p>
      ) : (
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b">
              <th className="p-2">Customer</th>
              <th className="p-2">Amount (INR)</th>
              <th className="p-2">Status</th>
              <th className="p-2">Created</th>
              <th className="p-2">Action</th>
            </tr>
          </thead>
          <tbody>
            {cases.map((c) => (
              <tr key={c.id} className="border-b">
                <td className="p-2">{c.customer_email}</td>
                <td className="p-2">{(c.amount_at_risk / 100).toLocaleString('en-IN', { style: 'currency', currency: 'INR' })}</td>
                <td className="p-2 uppercase text-xs font-semibold">{c.status}</td>
                <td className="p-2">{new Date(c.created_at).toLocaleDateString()}</td>
                <td className="p-2">
                  <Link href={`/merchant/cases/${c.id}`} className="text-indigo-600 hover:underline">View Case</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
