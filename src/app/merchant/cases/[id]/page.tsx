'use client';
import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import Link from 'next/link';

interface CaseDetail {
  case: { id: string; checkout_id: string; status: string; revenue_at_risk_paise: number; created_at: string };
  checkout: { id: string; status: string; customer_email: string; customer_phone: string | null; preferred_channel: string; consent_given: boolean; total_amount_paise: number; created_at: string };
  items: { id: string; product_id: string; product_name_snapshot: string; unit_price_paise_snapshot: number; quantity: number; line_total_paise: number }[];
  payments: { orders: { id: string; rzp_order_id: string; status: string; amount_paise: number }[]; attempts: { id: string; payment_order_id: string; rzp_payment_id: string | null; status: string; failure_code: string | null }[] };
  audit: { id: string; event_type: string; payload: unknown; created_at: string }[];
}

export default function MerchantCaseDetailPage() {
  const [data, setData] = useState<CaseDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const { id } = useParams<{ id: string }>();

  useEffect(() => {
    async function fetchData() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        router.push('/merchant/login');
        return;
      }

      try {
        const response = await fetch(`/api/recovery/cases/${id}`, {
          headers: {
            'Authorization': `Bearer ${session.access_token}`
          }
        });

        if (response.status === 401) {
          router.push('/merchant/login');
          return;
        }

        if (response.status === 403) {
          setError('Access Denied: You do not have permission to view this case.');
          setLoading(false);
          return;
        }

        if (response.status === 404) {
          setError('Recovery case not found');
          setLoading(false);
          return;
        }

        if (!response.ok) {
          throw new Error('Failed to fetch case details');
        }

        const json = await response.json();
        setData(json);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'An error occurred');
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [id, router]);

  if (loading) return <div className="p-8">Loading...</div>;
  if (error) return <div className="p-8 text-red-600">Error: {error}</div>;
  if (!data) return null;

  const formatINR = (paise: number) => (paise / 100).toLocaleString('en-IN', { style: 'currency', currency: 'INR' });

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-8">
      <Link href="/merchant/cases" className="text-indigo-600 hover:underline">&larr; Back to Recovery Cases</Link>

      <section>
        <h2 className="text-xl font-bold mb-4">Recovery Case</h2>
        <div className="bg-zinc-100 text-zinc-900 p-4 rounded">
          <p><strong>Case ID:</strong> {data.case.id}</p>
          <p><strong>Status:</strong> <span className="uppercase text-xs font-semibold">{data.case.status}</span></p>
          <p><strong>Amount at Risk:</strong> {formatINR(data.case.revenue_at_risk_paise)}</p>
          <p><strong>Created:</strong> {new Date(data.case.created_at).toLocaleString()}</p>
        </div>
      </section>

      <section>
        <h2 className="text-xl font-bold mb-4">Customer</h2>
        <div className="bg-zinc-100 text-zinc-900 p-4 rounded">
          <p><strong>Email:</strong> {data.checkout.customer_email}</p>
          <p><strong>Phone:</strong> {data.checkout.customer_phone || 'N/A'}</p>
          <p><strong>Channel:</strong> {data.checkout.preferred_channel}</p>
          <p><strong>Consent:</strong> {data.checkout.consent_given ? 'Yes' : 'No'}</p>
        </div>
      </section>

      <section>
        <h2 className="text-xl font-bold mb-4">Checkout</h2>
        <div className="bg-zinc-100 text-zinc-900 p-4 rounded">
          <p><strong>Checkout ID:</strong> {data.checkout.id}</p>
          <p><strong>Status:</strong> {data.checkout.status}</p>
          <p><strong>Total Amount:</strong> {formatINR(data.checkout.total_amount_paise)}</p>
          <p><strong>Created:</strong> {new Date(data.checkout.created_at).toLocaleString()}</p>
        </div>
      </section>

      <section>
        <h2 className="text-xl font-bold mb-4">Items</h2>
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b"><th className="p-2">Item</th><th className="p-2">Qty</th><th className="p-2">Price</th><th className="p-2">Total</th></tr>
          </thead>
          <tbody>
            {data.items.map((item) => (
              <tr key={item.id} className="border-b">
                <td className="p-2">{item.product_name_snapshot}</td>
                <td className="p-2">{item.quantity}</td>
                <td className="p-2">{formatINR(item.unit_price_paise_snapshot)}</td>
                <td className="p-2">{formatINR(item.line_total_paise)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h2 className="text-xl font-bold mb-4">Payment History</h2>
        {data.payments.orders.length === 0 ? <p>No payment history.</p> : (
          <div className="space-y-4">
            <table className="w-full text-left border-collapse">
              <thead><tr className="border-b"><th className="p-2">Order ID (RZP)</th><th className="p-2">Status</th><th className="p-2">Amount</th></tr></thead>
              <tbody>
                {data.payments.orders.map(o => (
                  <tr key={o.id} className="border-b">
                    <td className="p-2">{o.rzp_order_id}</td>
                    <td className="p-2">{o.status}</td>
                    <td className="p-2">{formatINR(o.amount_paise)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <table className="w-full text-left border-collapse">
              <thead><tr className="border-b"><th className="p-2">Payment ID (RZP)</th><th className="p-2">Status</th><th className="p-2">Failure Code</th></tr></thead>
              <tbody>
                {data.payments.attempts.map(a => (
                  <tr key={a.id} className="border-b">
                    <td className="p-2">{a.rzp_payment_id || 'N/A'}</td>
                    <td className="p-2">{a.status}</td>
                    <td className="p-2">{a.failure_code || 'None'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2 className="text-xl font-bold mb-4">Audit Trail</h2>
        <table className="w-full text-left border-collapse">
          <thead><tr className="border-b"><th className="p-2">Event</th><th className="p-2">Timestamp</th><th className="p-2">Payload</th></tr></thead>
          <tbody>
            {data.audit.map(a => (
              <tr key={a.id} className="border-b">
                <td className="p-2 font-mono text-xs">{a.event_type}</td>
                <td className="p-2">{new Date(a.created_at).toLocaleString()}</td>
                <td className="p-2 font-mono text-xs max-w-xs truncate" title={JSON.stringify(a.payload)}>{JSON.stringify(a.payload)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
