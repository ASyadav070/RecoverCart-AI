'use client';
import { useEffect, useState, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';

import { supabase } from '@/lib/supabase';
import { buttonVariants } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Separator } from '@/components/ui/separator';
import { RecoveryStatusBadge } from '@/components/recovery/RecoveryStatusBadge';
import { ActionPanel } from '@/components/recovery/ActionPanel';

interface CaseDetail {
  case: { id: string; checkout_id: string; status: string; revenue_at_risk_paise: number; created_at: string };
  checkout: { id: string; status: string; customer_email: string; customer_phone: string | null; preferred_channel: string; consent_given: boolean; total_amount_paise: number; created_at: string };
  proposal: {
    action: string;
    strategy: string;
    merchant_rationale: string;
    proposed_channel: string;
    proposed_message: string;
    discount_recommended: boolean;
    discount_type: string | null;
    discount_value: number | null;
  } | null;
  policy: { discounts_allowed: boolean; max_discount_percentage: number; low_stock_threshold: number };
  inventory_status: string;
  items: { id: string; product_id: string; product_name_snapshot: string; unit_price_paise_snapshot: number; quantity: number; line_total_paise: number }[];
  payments: { orders: { id: string; rzp_order_id: string; status: string; amount_paise: number }[]; attempts: { id: string; payment_order_id: string; rzp_payment_id: string | null; status: string; failure_code: string | null }[] };
  audit: { id: string; event_type: string; payload: unknown; created_at: string }[];
  outreach: { id: string; channel: string; message_body: string; sent_at: string; expires_at: string } | null;
}

export default function MerchantCaseDetailPage() {
  const [data, setData] = useState<CaseDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionState, setActionState] = useState<'idle' | 'approving' | 'rejecting' | 'regenerating'>('idle');
  const [generationType, setGenerationType] = useState<'initial' | 'rejection' | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [tempRecoveryUrl, setTempRecoveryUrl] = useState<string | null>(null);
  const router = useRouter();
  const { id } = useParams<{ id: string }>();

  const fetchCaseDetail = useCallback(async () => {
    setError(null);
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
        return;
      }
      if (response.status === 404) {
        setError('Recovery case not found');
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
  }, [id, router]);

  useEffect(() => {
    // We intentionally ignore the set-state-in-effect warning here
    // because fetchCaseDetail is async and sets state asynchronously
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchCaseDetail();
  }, [fetchCaseDetail]);

  const handleApprove = async () => {
    setActionState('approving');
    setActionError(null);
    setActionSuccess(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Unauthorized');

      const res = await fetch(`/api/recovery/cases/${id}/approve`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${session.access_token}` }
      });

      const resData = await res.json();
      if (!res.ok) throw new Error(resData.error || 'Approval failed');

      setActionSuccess('Proposal approved successfully.');
      await fetchCaseDetail();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'An error occurred during approval');
    } finally {
      setActionState('idle');
    }
  };

  const handleReject = async () => {
    setActionState('rejecting');
    setActionError(null);
    setActionSuccess(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Unauthorized');

      const rejectRes = await fetch(`/api/recovery/cases/${id}/reject`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${session.access_token}` }
      });
      const rejectData = await rejectRes.json();
      if (!rejectRes.ok) throw new Error(rejectData.error || 'Rejection failed');

      setActionState('regenerating');
      setGenerationType('rejection');
      const genRes = await fetch(`/api/recovery/cases/${id}/generate-strategy`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${session.access_token}` }
      });
      const genData = await genRes.json();
      if (!genRes.ok) throw new Error(genData.error || 'Regeneration failed');

      setActionSuccess('Proposal rejected and new strategy generated successfully.');
      await fetchCaseDetail();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'An error occurred during rejection/regeneration');
      await fetchCaseDetail();
    } finally {
      setActionState('idle');
    }
  };

  const handleSendOutreach = async () => {
    setActionState('approving'); // Using 'approving' state for sending
    setActionError(null);
    setActionSuccess(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Unauthorized');

      const res = await fetch(`/api/recovery/cases/${id}/send-outreach`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${session.access_token}` }
      });

      const resData = await res.json();
      if (res.status === 409) throw new Error(resData.error || 'This recovery case is not eligible for outreach.');
      if (!res.ok) throw new Error(resData.error || 'Unable to send simulated outreach.');

      if (resData.already_sent) {
        setActionSuccess('Outreach was already sent.');
      } else {
        setActionSuccess('Simulated outreach sent successfully.');
        setTempRecoveryUrl(resData.outreach.recovery_url);
      }
      await fetchCaseDetail();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Unable to send simulated outreach.');
    } finally {
      setActionState('idle');
    }
  };

  if (loading && !data) return <div className="p-8 min-h-screen bg-zinc-950 text-zinc-300 flex items-center justify-center">Loading case details...</div>;
  if (error) return <div className="p-8 min-h-screen bg-zinc-950 text-red-500 flex items-center justify-center">Error: {error}</div>;
  if (!data) return null;

  const formatINR = (paise: number) => (paise / 100).toLocaleString('en-IN', { style: 'currency', currency: 'INR' });

  // const statusColors: Record<string, string> = {
  //   'DETECTED': 'bg-zinc-800 text-zinc-300',
  //   'ANALYSING': 'bg-blue-900/30 text-blue-400 border border-blue-800',
  //   'AWAITING_APPROVAL': 'bg-amber-900/30 text-amber-400 border border-amber-800',
  //   'APPROVED': 'bg-emerald-900/30 text-emerald-400 border border-emerald-800',
  //   'REJECTED': 'bg-red-900/30 text-red-400 border border-red-800',
  //   'SENT': 'bg-purple-900/30 text-purple-400 border border-purple-800',
  //   'RECOVERED': 'bg-green-900/30 text-green-400 border border-green-800',
  //   'STOPPED': 'bg-zinc-800 text-zinc-500 border border-zinc-700',
  //   'ESCALATED': 'bg-orange-900/30 text-orange-400 border border-orange-800',
  // };

  const allStatuses = ['DETECTED', 'ANALYSING', 'AWAITING_APPROVAL', 'APPROVED', 'SENT', 'MONITORING', 'RECOVERED'];

  return (
    <div className="space-y-8 text-zinc-300">
      <header className="flex justify-between items-center border-b border-zinc-800 pb-4">
          <div>
            <Link href="/merchant/cases" className="text-sm text-indigo-400 hover:text-indigo-300 mb-2 inline-block">&larr; Back to Cases</Link>
            <h1 className="text-2xl font-bold text-zinc-100 flex items-center gap-3">
              Case Review
              <RecoveryStatusBadge status={data.case.status} />
            </h1>
            <p className="text-sm text-zinc-500 mt-1">ID: {data.case.id}</p>
          </div>
        </header>

        {/* Timeline */}
        <section className="py-4 border-b border-zinc-800">
          <div className="flex items-center justify-between relative">
            <div className="absolute left-0 top-1/2 w-full h-0.5 bg-zinc-800 -z-10 -translate-y-1/2"></div>
            {allStatuses.map((s, i) => {
              const isCurrent = data.case.status === s;
              const isPast = allStatuses.indexOf(data.case.status) > i;
              return (
                <div key={s} className="flex flex-col items-center gap-2 bg-zinc-950 px-2">
                  <div className={`w-3 h-3 rounded-full border-2 ${isCurrent ? 'bg-indigo-500 border-indigo-500' : isPast ? 'bg-zinc-500 border-zinc-500' : 'bg-zinc-950 border-zinc-700'}`}></div>
                  <span className={`text-[10px] font-medium tracking-wider uppercase ${isCurrent ? 'text-indigo-400' : isPast ? 'text-zinc-500' : 'text-zinc-700'}`}>{s.replace('_', ' ')}</span>
                </div>
              );
            })}
          </div>
        </section>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-8">

            {/* AI Recovery Proposal */}
            <Card className="bg-zinc-900 border-zinc-800">
              <CardHeader>
                <CardTitle className="text-lg font-semibold text-zinc-100 flex items-center gap-2">
                  AI Recovery Proposal
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                {!data.proposal ? (
                  <div className="text-zinc-500 italic text-sm py-4">No proposal generated yet.</div>
                ) : (
                  <>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="bg-zinc-950 p-3 rounded-lg border border-zinc-800">
                        <div className="text-xs text-zinc-500 uppercase tracking-wider mb-1">Recommended Action</div>
                        <div className="font-mono text-sm text-indigo-300">{data.proposal.action}</div>
                      </div>
                      <div className="bg-zinc-950 p-3 rounded-lg border border-zinc-800">
                        <div className="text-xs text-zinc-500 uppercase tracking-wider mb-1">Proposed Channel</div>
                        <div className="font-mono text-sm text-zinc-300">{data.proposal.proposed_channel}</div>
                      </div>
                    </div>

                    {data.proposal.discount_recommended && (
                      <Alert className="bg-emerald-950/30 border-emerald-900/50">
                        <AlertTitle className="text-emerald-500">Discount Recommended</AlertTitle>
                        <AlertDescription className="text-emerald-300">
                          A {data.proposal.discount_value}% {data.proposal.discount_type} discount is included in this proposal.
                        </AlertDescription>
                      </Alert>
                    )}

                    <div className="space-y-2">
                      <div className="text-xs text-zinc-500 uppercase tracking-wider">Generated Strategy</div>
                      <div className="bg-zinc-950 p-4 rounded-lg border border-zinc-800 text-sm text-zinc-300 leading-relaxed border-l-4 border-l-indigo-500/50">
                        {data.proposal.strategy}
                      </div>
                    </div>

                    <div className="space-y-2">
                      <div className="text-xs text-zinc-500 uppercase tracking-wider">Merchant Rationale (Internal)</div>
                      <div className="bg-zinc-950 p-4 rounded-lg border border-zinc-800 text-sm text-zinc-300 leading-relaxed">
                        {data.proposal.merchant_rationale}
                      </div>
                    </div>

                    <div className="space-y-2">
                      <div className="text-xs text-zinc-500 uppercase tracking-wider">Proposed Customer Message</div>
                      <div className="bg-zinc-950 p-4 rounded-lg border border-zinc-800 text-sm text-zinc-100 whitespace-pre-wrap font-sans">
                        {data.proposal.proposed_message}
                      </div>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            {/* Review Actions */}
            <Card className="bg-zinc-900 border-zinc-800">
              <CardHeader>
                <CardTitle className="text-lg font-semibold text-zinc-100">Review Actions</CardTitle>
              </CardHeader>
              <CardContent>
                {actionError && <Alert variant="destructive" className="mb-4"><AlertDescription>{actionError}</AlertDescription></Alert>}
                {actionSuccess && <Alert className="bg-emerald-950/30 border-emerald-900/50 text-emerald-300 mb-4"><AlertDescription>{actionSuccess}</AlertDescription></Alert>}

                <ActionPanel
                  status={data.case.status}
                  actionState={actionState}
                  loading={actionState !== 'idle'}
                  onGenerate={async () => {
                    setActionState('regenerating');
                    setGenerationType('initial');
                    try {
                      const { data: { session } } = await supabase.auth.getSession();
                      const res = await fetch(`/api/recovery/cases/${id}/generate-strategy`, {
                        method: 'POST',
                        headers: { 'Authorization': `Bearer ${session?.access_token}` }
                      });
                      if (!res.ok) throw new Error('Failed to generate strategy');
                      await fetchCaseDetail();
                    } catch {
                      setActionError('Failed to generate strategy');
                    } finally {
                      setActionState('idle');
                      setGenerationType(null);
                    }
                  }}
                  onApprove={handleApprove}
                  onReject={handleReject}
                  onSendOutreach={handleSendOutreach}
                  generationType={generationType}
                />

                {/* Terminal Status Messages */}
                {['SENT', 'MONITORING', 'RECOVERED', 'STOPPED', 'UNRECOVERED', 'EXPIRED', 'ESCALATED'].includes(data.case.status) && (
                  <Alert className="mt-4 bg-zinc-950 border-zinc-800">
                    <AlertTitle>
                      {data.case.status === 'SENT' && "Recovery outreach sent"}
                      {data.case.status === 'MONITORING' && "Monitoring recovery"}
                      {data.case.status === 'RECOVERED' && "Revenue successfully recovered"}
                      {data.case.status === 'STOPPED' && "Recovery stopped"}
                      {data.case.status === 'UNRECOVERED' && "Recovery attempt ended without payment"}
                      {data.case.status === 'EXPIRED' && "Recovery case expired"}
                      {data.case.status === 'ESCALATED' && "Escalated for manual review"}
                    </AlertTitle>
                    <AlertDescription className="text-zinc-400">
                      {data.case.status === 'SENT' && "The approved recovery message has been sent. Waiting for customer activity."}
                      {data.case.status === 'MONITORING' && "The customer has opened the recovery flow. Waiting for verified payment."}
                      {data.case.status === 'RECOVERED' && "The recovery payment has been verified successfully."}
                      {data.case.status === 'STOPPED' && "No further automated recovery action is available for this case."}
                      {data.case.status === 'UNRECOVERED' && "No verified recovery payment was completed for this case."}
                      {data.case.status === 'EXPIRED' && "This case is no longer active for automated recovery."}
                      {data.case.status === 'ESCALATED' && "Automated recovery has paused for this case."}
                    </AlertDescription>
                  </Alert>
                )}
              </CardContent>
            </Card>

            {data.outreach && (
              <Card className="bg-zinc-900 border-zinc-800">
                <CardHeader>
                  <CardTitle className="text-lg font-semibold text-zinc-100">Simulated Outreach Preview</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <p className="text-xs text-zinc-500 italic">No real message was sent. This is the buildathon simulation of customer outreach.</p>
                  <div className="bg-zinc-950 border border-zinc-800 p-4 rounded-lg space-y-3">
                    <div className="flex justify-between items-center">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${data.outreach.channel === 'WHATSAPP' ? 'bg-green-900 text-green-300' : 'bg-blue-900 text-blue-300'}`}>{data.outreach.channel}</span>
                      <span className="text-xs text-zinc-500">{new Date(data.outreach.sent_at).toLocaleString()}</span>
                    </div>
                    <div className="text-sm text-zinc-300 whitespace-pre-wrap">{data.outreach.message_body.split('\n\nComplete your purchase here:\n')[0]}</div>
                    <div className="pt-2">
                      {tempRecoveryUrl ? (
                        <a
                          href={tempRecoveryUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={buttonVariants({ size: 'sm' })}
                        >
                          Open Recovery Link
                        </a>
                      ) : (
                        <div className="text-xs text-zinc-500 py-1.5 px-3 border border-zinc-800 rounded bg-zinc-900 italic">
                          Recovery link is only available immediately after simulated send.
                        </div>
                      )}
                      <div className="text-[10px] text-zinc-600 mt-2">Expires: {new Date(data.outreach.expires_at).toLocaleString()}</div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            <Card className="bg-zinc-900 border-zinc-800">
              <CardHeader>
                <CardTitle className="text-lg font-semibold text-zinc-100">Audit Log</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {data.audit.map(a => (
                  <div key={a.id} className="flex gap-4">
                    <div className="w-32 flex-shrink-0 text-xs text-zinc-500 pt-0.5">
                      {new Date(a.created_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </div>
                    <div>
                      <div className="font-mono text-xs font-semibold text-zinc-300">{a.event_type}</div>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>

          <div className="space-y-6">
            <Card className="bg-zinc-900 border-zinc-800">
              <CardHeader>
                <CardTitle className="text-sm font-bold text-zinc-400 uppercase tracking-wider">Case Summary</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-zinc-500">Revenue at Risk</span>
                  <span className="text-zinc-100 font-medium">{formatINR(data.case.revenue_at_risk_paise)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">Checkout Total</span>
                  <span className="text-zinc-100">{formatINR(data.checkout.total_amount_paise)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">Created</span>
                  <span className="text-zinc-300">{new Date(data.case.created_at).toLocaleDateString()}</span>
                </div>
                <Separator className="bg-zinc-800" />
                <div className="pt-2">
                  <span className="block text-zinc-500 mb-1">Customer</span>
                  <span className="block text-zinc-100">{data.checkout.customer_email}</span>
                  {data.checkout.customer_phone && <span className="block text-zinc-400 text-xs">{data.checkout.customer_phone}</span>}
                  <span className="block text-zinc-400 text-xs mt-1">Prefers {data.checkout.preferred_channel} (Consent: {data.checkout.consent_given ? 'Yes' : 'No'})</span>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-zinc-900 border-zinc-800">
              <CardHeader>
                <CardTitle className="text-sm font-bold text-zinc-400 uppercase tracking-wider">Signals & Context</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 text-sm">
                <div>
                  <div className="text-zinc-500 mb-1">Payment State</div>
                  {data.payments.orders.length > 0 ? (
                    <div className="text-zinc-300">
                      Orders: {data.payments.orders.length}. Last Status: {data.payments.orders[data.payments.orders.length - 1].status}
                    </div>
                  ) : (
                    <div className="text-zinc-300">No payment order created.</div>
                  )}
                </div>

                <div>
                  <div className="text-zinc-500 mb-1">Payment Attempts</div>
                  {data.payments.attempts.length === 0 ? (
                    <span className="text-zinc-300">0 attempts (Abandoned)</span>
                  ) : (
                    <div className="space-y-1">
                      <div className="text-zinc-300 font-semibold mb-2">Total failed attempts: {data.payments.attempts.filter(a => a.status === 'FAILED').length}</div>
                      {data.payments.attempts.map(a => (
                        <div key={a.id} className="flex items-center gap-2">
                          <span className={`w-2 h-2 rounded-full ${a.status === 'FAILED' ? 'bg-destructive' : a.status === 'CAPTURED' ? 'bg-emerald-500' : 'bg-zinc-500'}`}></span>
                          <span className="text-zinc-300 font-mono text-xs">{a.status}</span>
                          {a.failure_code && <span className="text-zinc-500 text-xs">({a.failure_code})</span>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <Separator className="bg-zinc-800" />

                <div>
                  <div className="text-zinc-500 mb-1">Inventory Status</div>
                  <div className="text-zinc-300 flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${data.inventory_status === 'LOW_STOCK' ? 'bg-amber-500' : data.inventory_status === 'NORMAL' ? 'bg-green-500' : 'bg-zinc-500'}`}></span>
                    {data.inventory_status}
                  </div>
                </div>

                <div>
                  <div className="text-zinc-500 mb-1">Discount Policy</div>
                  <div className="text-zinc-300">
                    {data.policy.discounts_allowed
                      ? <span className="text-emerald-400">Enabled (Max {data.policy.max_discount_percentage}%)</span>
                      : <span className="text-zinc-500">Disabled</span>
                    }
                  </div>
                </div>

                <div>
                  <div className="text-zinc-500 mb-1">Items</div>
                  <ul className="text-zinc-300 text-xs space-y-1">
                    {data.items.map(i => (
                      <li key={i.id} className="flex justify-between">
                        <span className="truncate pr-2">{i.quantity}x {i.product_name_snapshot}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

    </div>
  );
}
