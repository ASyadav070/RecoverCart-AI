import { hashToken } from '@/lib/token';
import { PaymentButton } from '@/components/PaymentButton';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getSupabaseAdmin } from '@/lib/supabase';

interface PageProps {
  params: Promise<{ token: string }>;
}

type CheckoutStatus = 'STARTED' | 'PAID' | 'EXPIRED' | 'ABANDONED';

function StatusBlocker({ status }: { status: CheckoutStatus }) {
  const config: Record<
    Exclude<CheckoutStatus, 'STARTED'>,
    { title: string; body: string; color: string }
  > = {
    PAID: {
      title: 'Order Already Paid',
      body: 'This order has already been completed. Thank you for your purchase!',
      color: 'emerald',
    },
    EXPIRED: {
      title: 'Session Expired',
      body: 'This checkout session has expired. Please return to the store and start a new cart.',
      color: 'amber',
    },
    ABANDONED: {
      title: 'Session No Longer Active',
      body: 'This checkout session is no longer active. Please return to the store and start a new cart.',
      color: 'amber',
    },
  };

  const c = config[status as Exclude<CheckoutStatus, 'STARTED'>];
  const isGreen = c.color === 'emerald';

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-50 dark:bg-zinc-950 px-4">
      <div className="max-w-md w-full text-center bg-white dark:bg-zinc-900 p-8 rounded-2xl shadow-xl border border-zinc-200/50 dark:border-zinc-800/50">
        <div
          className={`w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-6 ${
            isGreen
              ? 'bg-emerald-100 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400'
              : 'bg-amber-100 dark:bg-amber-950/50 text-amber-600 dark:text-amber-400'
          }`}
        >
          {isGreen ? (
            <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          ) : (
            <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            </svg>
          )}
        </div>
        <h2 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50 mb-3">{c.title}</h2>
        <p className="text-zinc-600 dark:text-zinc-400 mb-8">{c.body}</p>
        <Link
          href="/"
          className="inline-flex h-12 items-center justify-center rounded-xl bg-zinc-900 dark:bg-zinc-50 text-white dark:text-zinc-900 px-6 font-medium transition-colors hover:bg-zinc-800 dark:hover:bg-zinc-200"
        >
          Back to Store
        </Link>
      </div>
    </div>
  );
}

function TokenInvalidPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-50 dark:bg-zinc-950 px-4">
      <div className="max-w-md w-full text-center bg-white dark:bg-zinc-900 p-8 rounded-2xl shadow-xl border border-zinc-200/50 dark:border-zinc-800/50">
        <div className="w-16 h-16 bg-red-100 dark:bg-red-950/50 text-red-600 dark:text-red-400 rounded-full flex items-center justify-center mx-auto mb-6">
          <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>
        <h2 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50 mb-3">Link Expired or Invalid</h2>
        <p className="text-zinc-600 dark:text-zinc-400 mb-8">
          This checkout link has expired or is invalid. Please return to the store and recreate your cart.
        </p>
        <Link
          href="/"
          className="inline-flex h-12 items-center justify-center rounded-xl bg-zinc-900 dark:bg-zinc-50 text-white dark:text-zinc-900 px-6 font-medium transition-colors hover:bg-zinc-800 dark:hover:bg-zinc-200"
        >
          Back to Store
        </Link>
      </div>
    </div>
  );
}

export default async function CheckoutSessionPage({ params }: PageProps) {
  const { token } = await params;
  if (!token) return notFound();

  // 1. Hash the incoming URL token — never trust the raw value
  const tokenHash = hashToken(token);
  const dbAdmin = getSupabaseAdmin();
  const now = new Date().toISOString();

  // 2. Look up session: must exist AND not be expired
  const { data: session, error: sessionError } = await dbAdmin
    .from('checkout_sessions')
    .select('id, expires_at, checkout_id')
    .eq('session_token_hash', tokenHash)
    .gt('expires_at', now)   // expired tokens are rejected here
    .single();

  if (sessionError || !session) {
    return <TokenInvalidPage />;
  }

  // 3. Fetch the linked checkout — must exist AND be STARTED
  const { data: checkout, error: checkoutError } = await dbAdmin
    .from('checkouts')
    .select('id, status, customer_email, customer_phone, preferred_channel, consent_given, total_amount_paise')
    .eq('id', session.checkout_id)
    .single();

  if (checkoutError || !checkout) return notFound();

  // 4. Guard: PAID, EXPIRED, ABANDONED checkouts must not be treated as active
  if (checkout.status !== 'STARTED') {
    return <StatusBlocker status={checkout.status as CheckoutStatus} />;
  }

  // 5. Fetch line items (only for STARTED checkouts)
  const { data: checkoutItems, error: itemsError } = await dbAdmin
    .from('checkout_items')
    .select('id, product_name_snapshot, unit_price_paise_snapshot, quantity, line_total_paise')
    .eq('checkout_id', session.checkout_id);

  if (itemsError || !checkoutItems) return notFound();

  const formatPrice = (paise: number) =>
    new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(paise / 100);

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto">
        <header className="mb-10 text-center sm:text-left">
          <h1 className="text-3xl font-extrabold tracking-tight text-zinc-900 dark:text-zinc-50">
            Review Your Order
          </h1>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            Please verify your cart items and customer information before proceeding to payment.
          </p>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          {/* Order Details */}
          <div className="lg:col-span-8 space-y-6">
            <div className="bg-white dark:bg-zinc-900 rounded-2xl p-6 shadow-sm border border-zinc-200/50 dark:border-zinc-800/50">
              <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-50 mb-4 border-b border-zinc-100 dark:border-zinc-800 pb-3">
                Items in Order
              </h2>
              <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {checkoutItems.map((item) => (
                  <div key={item.id} className="py-4 flex justify-between items-center">
                    <div>
                      <h3 className="font-semibold text-zinc-900 dark:text-zinc-50">
                        {item.product_name_snapshot}
                      </h3>
                      <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-0.5">
                        Qty: {item.quantity} × {formatPrice(item.unit_price_paise_snapshot)}
                      </p>
                    </div>
                    <span className="font-semibold text-zinc-900 dark:text-zinc-50">
                      {formatPrice(item.line_total_paise)}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-white dark:bg-zinc-900 rounded-2xl p-6 shadow-sm border border-zinc-200/50 dark:border-zinc-800/50">
              <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-50 mb-4 border-b border-zinc-100 dark:border-zinc-800 pb-3">
                Contact Information
              </h2>
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                <div>
                  <dt className="text-zinc-500 dark:text-zinc-400 font-medium">Email Address</dt>
                  <dd className="text-zinc-900 dark:text-zinc-50 font-semibold mt-1">
                    {checkout.customer_email}
                  </dd>
                </div>
                <div>
                  <dt className="text-zinc-500 dark:text-zinc-400 font-medium">Phone Number</dt>
                  <dd className="text-zinc-900 dark:text-zinc-50 font-semibold mt-1">
                    {checkout.customer_phone}
                  </dd>
                </div>
                <div>
                  <dt className="text-zinc-500 dark:text-zinc-400 font-medium">Notification Channel</dt>
                  <dd className="text-zinc-900 dark:text-zinc-50 font-semibold mt-1 capitalize">
                    {checkout.preferred_channel?.toLowerCase()}
                  </dd>
                </div>
                <div>
                  <dt className="text-zinc-500 dark:text-zinc-400 font-medium">Recovery Consent</dt>
                  <dd className="text-emerald-600 dark:text-emerald-400 font-semibold mt-1 flex items-center gap-1.5">
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                    Given
                  </dd>
                </div>
              </dl>
            </div>
          </div>

          {/* Summary & Actions */}
          <div className="lg:col-span-4">
            <div className="bg-white dark:bg-zinc-900 rounded-2xl p-6 shadow-sm border border-zinc-200/50 dark:border-zinc-800/50 sticky top-6">
              <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-50 mb-4 border-b border-zinc-100 dark:border-zinc-800 pb-3">
                Summary
              </h2>
              <div className="space-y-4">
                <div className="flex justify-between text-sm">
                  <span className="text-zinc-600 dark:text-zinc-400">Subtotal</span>
                  <span className="text-zinc-900 dark:text-zinc-50 font-medium">
                    {formatPrice(checkout.total_amount_paise)}
                  </span>
                </div>
                <div className="flex justify-between text-sm border-b border-zinc-100 dark:border-zinc-800 pb-4">
                  <span className="text-zinc-600 dark:text-zinc-400">Shipping</span>
                  <span className="text-emerald-600 dark:text-emerald-400 font-medium">Free</span>
                </div>
                <div className="flex justify-between items-center text-lg font-bold text-zinc-900 dark:text-zinc-50 pt-2">
                  <span>Total Due</span>
                  <span>{formatPrice(checkout.total_amount_paise)}</span>
                </div>
              </div>

              <div className="mt-8 space-y-3">
                {/* Phase 2 will wire this button to Razorpay order creation */}
                {/* Phase 2 wiring implemented */}
                <PaymentButton token={token} />
                <Link
                  href="/"
                  className="w-full h-12 inline-flex items-center justify-center rounded-xl border border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300 font-semibold transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
                >
                  Cancel &amp; Edit Cart
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
