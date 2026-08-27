'use client';

import { useState } from 'react';

interface PaymentButtonProps {
  token: string;
}

interface RazorpayResponse {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}

interface RazorpayFailure {
  error: {
    description: string;
  };
}

interface RazorpayOptions {
  key: string;
  order_id: string;
  amount: number;
  currency: string;
  name: string;
  handler: (response: RazorpayResponse) => Promise<void>;
  modal: { ondismiss: () => void };
}

interface RazorpayInstance {
  open: () => void;
  on: (event: string, callback: (response: RazorpayFailure) => void) => void;
}

declare global {
  interface Window {
    Razorpay: new (options: RazorpayOptions) => RazorpayInstance;
  }
}

export function PaymentButton({ token }: PaymentButtonProps) {
  const [loading, setLoading] = useState(false);

  const handlePayment = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/payment/create-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });

      if (!response.ok) {
        throw new Error('Failed to create order');
      }

      const order = await response.json();

      // Require authoritative values from the server response
      if (!order.key || !order.order_id || !order.amount || !order.currency) {
        throw new Error('Invalid order response');
      }

      if (!window.Razorpay) {
        await new Promise<void>((resolve) => {
          const script = document.createElement('script');
          script.src = 'https://checkout.razorpay.com/v1/checkout.js';
          script.onload = () => resolve();
          script.onerror = () => {
            throw new Error('Failed to load Razorpay Checkout script');
          };
          document.body.appendChild(script);
        });
      }

      if (!window.Razorpay) {
        throw new Error('Razorpay Checkout is not available');
      }

      const options: RazorpayOptions = {
        key: order.key,
        order_id: order.order_id,
        amount: order.amount,
        currency: order.currency,
        name: 'RecoverCart Store',
        handler: async (response) => {
          try {
            const verificationResponse = await fetch('/api/payment/verify-provisional', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                token,
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_order_id: response.razorpay_order_id,
                razorpay_signature: response.razorpay_signature,
              }),
            });

            const verificationBody = await verificationResponse.json();

            if (!verificationResponse.ok || verificationBody.provisional !== true) {
              alert('Payment verification failed. Please contact support.');
              return;
            }

            alert('Payment Successful (Provisional)');
          } catch (err) {
            console.error('Verification handler error', err);
            alert('Payment verification failed. Please contact support.');
          }
        },
        modal: {
          ondismiss: () => {
            setLoading(false);
          },
        },
      };

      const rzp = new window.Razorpay(options);
      rzp.on('payment.failed', (response) => {
        alert('Payment failed: ' + response.error.description);
        setLoading(false);
      });
      rzp.open();
    } catch (err) {
      console.error('Payment handler error', err);
      alert('Payment failed. Please try again.');
      setLoading(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handlePayment}
      disabled={loading}
      className="w-full h-12 inline-flex items-center justify-center rounded-xl bg-zinc-900 dark:bg-zinc-50 text-white dark:text-zinc-900 font-bold transition-all hover:bg-zinc-800 dark:hover:bg-zinc-200 active:scale-[0.98] disabled:opacity-50"
    >
      {loading ? 'Processing...' : 'Proceed to Payment'}
    </button>
  );
}
