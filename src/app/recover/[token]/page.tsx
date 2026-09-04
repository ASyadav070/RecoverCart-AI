'use client';

import { useEffect, useState, useRef } from 'react';
import { useParams } from 'next/navigation';

interface RecoveryData {
  recovery: { status: string; opened_at: string; expires_at: string };
  checkout: { id: string; status: string; total_amount_paise: number; created_at: string };
  items: Array<{ id: string; product_name: string; unit_price_paise: number; quantity: number; line_total_paise: number }>;
}

const POLL_INTERVAL_MS = 2500;
const MAX_POLL_DURATION_MS = 60000;

async function loadRazorpayScript(): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  if (window.Razorpay) return true;
  return new Promise((resolve) => {
    const existingScript = document.querySelector('script[src="https://checkout.razorpay.com/v1/checkout.js"]');
    if (existingScript) {
      existingScript.addEventListener('load', () => resolve(true));
      existingScript.addEventListener('error', () => resolve(false));
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
}

type PaymentStatus =
  | 'idle'
  | 'preparing'
  | 'opening'
  | 'verifying'
  | 'pending_verification'
  | 'failed'
  | 'success';

export default function CustomerRecoveryPage() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<RecoveryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ title: string; message: string } | null>(null);
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus>('idle');
  const [paymentMessage, setPaymentMessage] = useState<string | null>(null);
  const pollTimerRef = useRef<NodeJS.Timeout | null>(null);
  const startTimeRef = useRef<number | null>(null);

  useEffect(() => {
    if (paymentStatus !== 'verifying') {
      if (pollTimerRef.current) {
        clearTimeout(pollTimerRef.current);
        pollTimerRef.current = null;
      }
      return;
    }

    let cancelled = false;
    startTimeRef.current = Date.now();

    const poll = async () => {
      const elapsed = Date.now() - (startTimeRef.current || 0);
      if (elapsed > MAX_POLL_DURATION_MS) {
        setPaymentStatus('pending_verification');
        setPaymentMessage('Payment is still being verified. You can refresh this page.');
        return;
      }

      try {
        const res = await fetch('/api/recovery/payment/status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token })
        });

        if (cancelled) return;

        if (res.status === 404) {
          setError({ title: 'Recovery link unavailable', message: 'This recovery session is no longer available.' });
          return;
        }

        if (res.status === 410) {
          setError({ title: 'Recovery link expired', message: 'This recovery link has expired.' });
          return;
        }

        if (!res.ok) {
          if (!cancelled) pollTimerRef.current = setTimeout(poll, POLL_INTERVAL_MS);
          return;
        }

        const data = await res.json();
        
        if (data.payment_status === 'PAID' && data.recovery_status === 'RECOVERED') {
          setPaymentStatus('success');
        } else if (data.payment_status === 'PAID' && data.recovery_status === 'MONITORING') {
          setPaymentMessage('Payment received. Finalizing recovery...');
          if (!cancelled) pollTimerRef.current = setTimeout(poll, POLL_INTERVAL_MS);
        } else {
          if (!cancelled) pollTimerRef.current = setTimeout(poll, POLL_INTERVAL_MS);
        }
      } catch {
        if (!cancelled) pollTimerRef.current = setTimeout(poll, POLL_INTERVAL_MS);
      }
    };

    poll();

    return () => {
      cancelled = true;
      if (pollTimerRef.current) {
        clearTimeout(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [paymentStatus, token]);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/recovery/open', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token })
        });
        const resData = await res.json();
        
        if (!res.ok) {
          switch (res.status) {
            case 404: setError({ title: 'Recovery link not found', message: 'This recovery link is invalid or no longer available.' }); break;
            case 410: setError({ title: 'Recovery link expired', message: 'This recovery link has expired. Please return to the store and start checkout again.' }); break;
            case 409: setError({ title: resData.error === 'Checkout already paid' ? 'Payment already completed' : 'Recovery link unavailable', message: resData.error === 'Checkout already paid' ? 'This order has already been paid successfully.' : 'This recovery session can no longer be used.' }); break;
            default: setError({ title: 'Unable to load recovery checkout', message: 'Please try again in a moment.' });
          }
          return;
        }
        setData(resData);
      } catch {
        setError({ title: 'Unable to load recovery checkout', message: 'Please try again in a moment.' });
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [token]);

  const handlePayment = async () => {
    if (paymentStatus === 'preparing' || paymentStatus === 'opening' || paymentStatus === 'verifying') {
      return;
    }

    setPaymentMessage(null);
    setPaymentStatus('preparing');

    try {
      const scriptLoaded = await loadRazorpayScript();
      if (!scriptLoaded || !window.Razorpay) {
        setPaymentStatus('failed');
        setPaymentMessage('Unable to load payment gateway. Please try again.');
        return;
      }

      const res = await fetch('/api/recovery/payment/create-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token })
      });

      const resData = await res.json();

      if (!res.ok) {
        setPaymentStatus('failed');
        switch (res.status) {
          case 404:
            setPaymentMessage('Recovery link is invalid or no longer available.');
            break;
          case 410:
            setPaymentMessage('This recovery link has expired.');
            break;
          case 409:
            if (resData.error === 'Checkout already paid') {
              setPaymentMessage('This order has already been paid.');
            } else {
              setPaymentMessage('This recovery session is no longer active.');
            }
            break;
          default:
            setPaymentMessage('Unable to prepare payment. Please try again.');
            break;
        }
        return;
      }

      const { key, order_id, amount, currency } = resData;

      if (!key || !order_id || !amount || !currency) {
        setPaymentStatus('failed');
        setPaymentMessage('Unable to prepare payment. Please try again.');
        return;
      }

      setPaymentStatus('opening');

      const options: RazorpayOptions = {
        key,
        order_id,
        amount,
        currency,
        name: 'RecoverCart AI',
        description: 'Complete your recovered checkout',
      handler: () => {
        setPaymentStatus('verifying');
        setPaymentMessage('Verifying payment...');
      },
      modal: {
        ondismiss: () => {
          setPaymentStatus('failed');
          setPaymentMessage('Payment was not completed. You can try again.');
        }
      }
    };

      const rzp = new window.Razorpay(options);
      rzp.on('payment.failed', () => {
        setPaymentStatus('failed');
        setPaymentMessage('Payment was not completed. You can try again.');
      });
      rzp.open();
    } catch {
      setPaymentStatus('failed');
      setPaymentMessage('Unable to prepare payment. Please try again.');
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-lg p-6 space-y-4">
          <div className="h-6 w-1/3 bg-zinc-800 rounded animate-pulse" />
          <div className="space-y-2">
            <div className="h-4 w-full bg-zinc-800 rounded animate-pulse" />
            <div className="h-4 w-full bg-zinc-800 rounded animate-pulse" />
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-lg p-6 space-y-2">
          <h2 className="text-xl font-bold text-zinc-100">{error.title}</h2>
          <p className="text-zinc-400">{error.message}</p>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const isButtonDisabled = ['preparing', 'opening', 'verifying', 'pending_verification', 'success'].includes(paymentStatus);

  let buttonText = 'Continue to Secure Payment';
  if (paymentStatus === 'preparing') buttonText = 'Preparing secure payment...';
  if (paymentStatus === 'opening') buttonText = 'Opening Razorpay...';
  if (paymentStatus === 'verifying') buttonText = 'Verifying payment...';
  if (paymentStatus === 'pending_verification') buttonText = 'Verification pending';
  if (paymentStatus === 'success') buttonText = 'Payment Complete';

  return (
    <div className="min-h-screen bg-zinc-950 p-4 md:p-8 flex flex-col items-center">
      <header className="mb-8">
        <h1 className="text-2xl font-bold text-zinc-100 tracking-tight">RecoverCart AI</h1>
      </header>

      <div className="w-full max-w-2xl bg-zinc-900 border border-zinc-800 rounded-xl p-6 shadow-xl space-y-6">
        <div className="flex justify-between items-start">
          <div>
            <h2 className="text-2xl font-semibold text-zinc-100">Complete your purchase</h2>
            <p className="text-zinc-400 text-sm">Your checkout is ready to continue securely.</p>
          </div>
          <span className="bg-zinc-800 text-zinc-300 text-xs px-2.5 py-1 rounded-full border border-zinc-700">Recovery session active</span>
        </div>
        
        <div className="space-y-4 text-zinc-100">
          <div className="space-y-3">
            {data.items.map(item => (
              <div key={item.id} className="flex justify-between items-center text-sm">
                <span>{item.product_name} x {item.quantity}</span>
                <span>₹{(item.line_total_paise / 100).toFixed(2)}</span>
              </div>
            ))}
            <div className="border-t border-zinc-800 my-4" />
            <div className="flex justify-between font-bold text-lg">
              <span>Total</span>
              <span>₹{(data.checkout.total_amount_paise / 100).toFixed(2)}</span>
            </div>
          </div>

          {paymentStatus === 'verifying' && (
            <div className="bg-zinc-800 border border-zinc-700 p-4 rounded-lg flex items-start gap-3">
              <span className="text-emerald-400 font-bold">✓</span>
              <div>
                <h4 className="font-semibold text-zinc-100">Payment submitted</h4>
                <p className="text-sm text-zinc-300">{paymentMessage}</p>
              </div>
            </div>
          )}

          {paymentStatus === 'pending_verification' && (
            <div className="bg-zinc-800 border border-zinc-700 p-4 rounded-lg flex items-start gap-3">
              <span className="text-amber-400 font-bold">ℹ</span>
              <div>
                <h4 className="font-semibold text-zinc-100">Payment verification pending</h4>
                <p className="text-sm text-zinc-300">{paymentMessage}</p>
              </div>
            </div>
          )}

          {paymentStatus === 'failed' && paymentMessage && (
            <div className="bg-zinc-800 border border-amber-900/50 p-4 rounded-lg flex items-start gap-3">
              <span className="text-amber-400 font-bold">ℹ</span>
              <div>
                <p className="text-sm text-zinc-300">{paymentMessage}</p>
              </div>
            </div>
          )}
        </div>

        {paymentStatus === 'success' ? (
          <div className="bg-emerald-900/20 border border-emerald-800 p-6 rounded-lg text-center space-y-2">
            <h3 className="text-xl font-bold text-emerald-400">Payment successful</h3>
            <p className="text-sm text-emerald-200">Your payment has been verified and your order is complete.</p>
          </div>
        ) : (
          <div className="pt-4 flex flex-col gap-4">
            <button 
              className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-medium py-2.5 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={handlePayment}
              disabled={isButtonDisabled}
            >
              {buttonText}
            </button>
            <div className="text-[11px] text-zinc-500 text-center">
              Recovery link valid until {new Date(data.recovery.expires_at).toLocaleDateString()}
            </div>
          </div>
        )}
      </div>

      <footer className="mt-auto pt-8 text-zinc-600 text-xs">
        Secure checkout powered by Razorpay
      </footer>
    </div>
  );
}

