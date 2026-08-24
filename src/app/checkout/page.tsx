'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { CartItem } from '@/types/store';

export default function CheckoutPage() {
  const router = useRouter();
  const [cart, setCart] = useState<CartItem[]>([]);
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [channelPreference, setChannelPreference] = useState<'EMAIL' | 'WHATSAPP'>('EMAIL');
  const [consentGiven, setConsentGiven] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  useEffect(() => {
    const storedCart = localStorage.getItem('cart');
    if (storedCart) {
      try {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setCart(JSON.parse(storedCart));
      } catch (e) {
        console.error('Error loading cart:', e);
      }
    }
  }, []);

  const cartSubtotal = cart.reduce(
    (sum, item) => sum + item.product.price_paise * item.quantity,
    0
  );

  const formatPrice = (paise: number) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
    }).format(paise / 100);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setFieldErrors({});

    if (cart.length === 0) {
      setError('Your cart is empty. Please add products before checking out.');
      return;
    }

    if (!consentGiven) {
      setError('You must consent to recovery contact to proceed.');
      return;
    }

    setLoading(true);

    try {
      const response = await fetch('/api/checkout/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          phone,
          channelPreference,
          consentGiven,
          items: cart.map((item) => ({
            productId: item.product.id,
            quantity: item.quantity,
          })),
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        if (data.details) {
          setFieldErrors(data.details);
          setError('Please check the validation errors below.');
        } else {
          setError(data.error || 'Something went wrong during checkout.');
        }
        return;
      }

      // Clear cart on successful checkout
      localStorage.removeItem('cart');
      
      // Redirect to secure session token page
      router.push(`/checkout/session/${data.token}`);
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (cart.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-50 dark:bg-zinc-950 px-4">
        <div className="max-w-md w-full text-center bg-white dark:bg-zinc-900 p-8 rounded-2xl shadow-xl border border-zinc-200/50 dark:border-zinc-800/50">
          <h2 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50 mb-3">Your Cart is Empty</h2>
          <p className="text-zinc-600 dark:text-zinc-400 mb-8">
            Add items to your cart before proceeding to checkout.
          </p>
          <Link href="/" className="inline-flex h-12 items-center justify-center rounded-xl bg-zinc-900 dark:bg-zinc-50 text-white dark:text-zinc-900 px-6 font-medium transition-colors hover:bg-zinc-800 dark:hover:bg-zinc-200">
            Browse Products
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto">
        <header className="mb-10 text-center sm:text-left">
          <Link href="/" className="text-sm font-semibold text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1 mb-2">
            ← Back to Store
          </Link>
          <h1 className="text-3xl font-extrabold tracking-tight text-zinc-900 dark:text-zinc-50">Checkout</h1>
        </header>

        {error && (
          <div className="mb-6 p-4 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200/50 dark:border-red-900/50 text-red-600 dark:text-red-400 text-sm font-medium">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          {/* Guest Contact Details */}
          <div className="lg:col-span-7 space-y-6">
            <div className="bg-white dark:bg-zinc-900 rounded-2xl p-6 shadow-sm border border-zinc-200/50 dark:border-zinc-800/50">
              <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-50 mb-6 pb-2 border-b border-zinc-100 dark:border-zinc-800">
                Contact Information
              </h2>
              
              <div className="space-y-4">
                <div>
                  <label htmlFor="email" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
                    Email Address
                  </label>
                  <input
                    type="email"
                    id="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="w-full h-11 px-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-transparent text-zinc-900 dark:text-zinc-50 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all text-sm"
                  />
                  {fieldErrors.email && (
                    <p className="mt-1.5 text-xs text-red-500">{fieldErrors.email[0]}</p>
                  )}
                </div>

                <div>
                  <label htmlFor="phone" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
                    Phone Number
                  </label>
                  <input
                    type="tel"
                    id="phone"
                    required
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+91 99999 99999"
                    className="w-full h-11 px-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-transparent text-zinc-900 dark:text-zinc-50 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all text-sm"
                  />
                  {fieldErrors.phone && (
                    <p className="mt-1.5 text-xs text-red-500">{fieldErrors.phone[0]}</p>
                  )}
                </div>
              </div>
            </div>

            <div className="bg-white dark:bg-zinc-900 rounded-2xl p-6 shadow-sm border border-zinc-200/50 dark:border-zinc-800/50">
              <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-50 mb-6 pb-2 border-b border-zinc-100 dark:border-zinc-800">
                Recovery Preferences
              </h2>

              <div className="space-y-6">
                <div>
                  <span className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-3">
                    Preferred Communication Channel
                  </span>
                  <div className="flex gap-4">
                    <label className="flex-1 flex items-center justify-between p-3.5 rounded-xl border border-zinc-200 dark:border-zinc-800 cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/20 transition-all">
                      <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Email</span>
                      <input
                        type="radio"
                        name="channel"
                        value="EMAIL"
                        checked={channelPreference === 'EMAIL'}
                        onChange={() => setChannelPreference('EMAIL')}
                        className="w-4 h-4 text-indigo-600 focus:ring-indigo-500"
                      />
                    </label>

                    <label className="flex-1 flex items-center justify-between p-3.5 rounded-xl border border-zinc-200 dark:border-zinc-800 cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/20 transition-all">
                      <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">WhatsApp</span>
                      <input
                        type="radio"
                        name="channel"
                        value="WHATSAPP"
                        checked={channelPreference === 'WHATSAPP'}
                        onChange={() => setChannelPreference('WHATSAPP')}
                        className="w-4 h-4 text-indigo-600 focus:ring-indigo-500"
                      />
                    </label>
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-indigo-50/50 dark:bg-indigo-950/20 border border-indigo-100/50 dark:border-indigo-900/30">
                  <label className="flex items-start gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={consentGiven}
                      onChange={(e) => setConsentGiven(e.target.checked)}
                      className="w-5 h-5 rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500 mt-0.5"
                    />
                    <span className="text-xs text-indigo-950 dark:text-indigo-200 leading-normal">
                      I explicitly agree to receive checkout recovery messages via my selected channel if I leave before completing my payment. I understand I can opt-out at any time.
                    </span>
                  </label>
                  {fieldErrors.consentGiven && (
                    <p className="mt-1.5 text-xs text-red-500">{fieldErrors.consentGiven[0]}</p>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Cart summary column */}
          <div className="lg:col-span-5">
            <div className="bg-white dark:bg-zinc-900 rounded-2xl p-6 shadow-sm border border-zinc-200/50 dark:border-zinc-800/50 sticky top-6">
              <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-50 mb-4 pb-2 border-b border-zinc-100 dark:border-zinc-800">
                Order Summary
              </h2>

              <div className="max-h-60 overflow-y-auto divide-y divide-zinc-100 dark:divide-zinc-800 pr-2">
                {cart.map((item) => (
                  <div key={item.product.id} className="py-3 flex justify-between items-center text-sm">
                    <div className="pr-4">
                      <span className="font-semibold text-zinc-900 dark:text-zinc-50">{item.product.name}</span>
                      <p className="text-zinc-500 dark:text-zinc-400 text-xs mt-0.5">
                        Qty: {item.quantity} × {formatPrice(item.product.price_paise)}
                      </p>
                    </div>
                    <span className="font-semibold text-zinc-900 dark:text-zinc-50">
                      {formatPrice(item.product.price_paise * item.quantity)}
                    </span>
                  </div>
                ))}
              </div>

              <div className="border-t border-zinc-100 dark:border-zinc-800 mt-4 pt-4 space-y-3">
                <div className="flex justify-between items-center text-base font-bold text-zinc-900 dark:text-zinc-50">
                  <span>Total Amount</span>
                  <span>{formatPrice(cartSubtotal)}</span>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full h-12 inline-flex items-center justify-center rounded-xl bg-zinc-900 dark:bg-zinc-50 text-white dark:text-zinc-900 font-bold transition-all hover:bg-zinc-800 dark:hover:bg-zinc-200 active:scale-[0.98] mt-8 disabled:opacity-50"
              >
                {loading ? 'Processing...' : 'Confirm Details'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
