'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Product, CartItem } from '@/types/store';

interface StoreFrontProps {
  initialProducts: Product[];
}

export default function StoreFront({ initialProducts }: StoreFrontProps) {
  const [products] = useState<Product[]>(initialProducts);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<string>('All');

  // Load cart from localStorage
  useEffect(() => {
    const storedCart = localStorage.getItem('cart');
    if (storedCart) {
      try {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setCart(JSON.parse(storedCart));
      } catch (e) {
        console.error('Failed to load cart from storage', e);
      }
    }
  }, []);

  // Save cart to localStorage
  const saveCart = (newCart: CartItem[]) => {
    setCart(newCart);
    localStorage.setItem('cart', JSON.stringify(newCart));
  };

  const categories = ['All', ...Array.from(new Set(products.map((p) => p.category)))];

  const filteredProducts = categoryFilter === 'All'
    ? products
    : products.filter((p) => p.category === categoryFilter);

  const addToCart = (product: Product) => {
    const existing = cart.find((item) => item.product.id === product.id);
    const currentQty = existing ? existing.quantity : 0;

    if (currentQty >= product.stock) {
      alert(`Cannot add more. Only ${product.stock} items left in stock.`);
      return;
    }

    let newCart: CartItem[];
    if (existing) {
      newCart = cart.map((item) =>
        item.product.id === product.id
          ? { ...item, quantity: item.quantity + 1 }
          : item
      );
    } else {
      newCart = [...cart, { product, quantity: 1 }];
    }
    saveCart(newCart);
    setIsCartOpen(true);
  };

  const updateQuantity = (productId: string, delta: number) => {
    const item = cart.find((i) => i.product.id === productId);
    if (!item) return;

    const newQty = item.quantity + delta;
    if (newQty <= 0) {
      saveCart(cart.filter((i) => i.product.id !== productId));
      return;
    }

    if (newQty > item.product.stock) {
      alert(`Cannot update quantity. Only ${item.product.stock} items left in stock.`);
      return;
    }

    saveCart(
      cart.map((i) =>
        i.product.id === productId ? { ...i, quantity: newQty } : i
      )
    );
  };

  const removeFromCart = (productId: string) => {
    saveCart(cart.filter((i) => i.product.id !== productId));
  };

  const cartCount = cart.reduce((sum, item) => sum + item.quantity, 0);
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

  return (
    <div className="relative">
      {/* Category Filter & Cart Toggle bar */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8">
        <div className="flex flex-wrap gap-2">
          {categories.map((category) => (
            <button
              key={category}
              onClick={() => setCategoryFilter(category)}
              className={`px-4 py-2 rounded-xl text-sm font-semibold transition-all ${
                categoryFilter === category
                  ? 'bg-indigo-600 text-white'
                  : 'bg-white dark:bg-zinc-900 border border-zinc-200/50 dark:border-zinc-800/50 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50'
              }`}
            >
              {category}
            </button>
          ))}
        </div>

        <button
          onClick={() => setIsCartOpen(true)}
          className="relative inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-zinc-900 dark:bg-zinc-50 text-white dark:text-zinc-900 font-semibold hover:bg-zinc-800 dark:hover:bg-zinc-200 active:scale-[0.98] transition-all"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
          </svg>
          Cart
          {cartCount > 0 && (
            <span className="absolute -top-2 -right-2 flex h-5 w-5 items-center justify-center rounded-full bg-indigo-600 text-white text-xs font-bold ring-2 ring-white dark:ring-zinc-900">
              {cartCount}
            </span>
          )}
        </button>
      </div>

      {/* Catalog Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredProducts.map((product) => (
          <div
            key={product.id}
            className="flex flex-col bg-white dark:bg-zinc-900 rounded-2xl overflow-hidden border border-zinc-200/50 dark:border-zinc-800/50 hover:shadow-lg transition-all"
          >
            {/* Simple colored block as image fallback */}
            <div className="h-48 w-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center text-zinc-400">
              <svg className="w-12 h-12" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </div>
            
            <div className="p-6 flex flex-col flex-1">
              <span className="text-xs font-bold tracking-wider uppercase text-indigo-600 dark:text-indigo-400">
                {product.category}
              </span>
              <h3 className="mt-2 text-lg font-bold text-zinc-900 dark:text-zinc-50 line-clamp-1">
                {product.name}
              </h3>
              <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400 line-clamp-2 flex-1">
                {product.description}
              </p>
              
              <div className="mt-6 flex items-center justify-between">
                <span className="text-xl font-extrabold text-zinc-900 dark:text-zinc-50">
                  {formatPrice(product.price_paise)}
                </span>
                
                {product.stock > 0 ? (
                  <button
                    onClick={() => addToCart(product)}
                    className="h-10 px-4 rounded-xl bg-zinc-900 dark:bg-zinc-50 text-white dark:text-zinc-900 text-sm font-semibold hover:bg-zinc-800 dark:hover:bg-zinc-200 active:scale-[0.98] transition-all"
                  >
                    Add to Cart
                  </button>
                ) : (
                  <span className="text-sm font-semibold text-red-500 bg-red-50 dark:bg-red-950/20 px-2.5 py-1 rounded-lg">
                    Out of Stock
                  </span>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Cart Drawer Overlay */}
      {isCartOpen && (
        <div className="fixed inset-0 z-50 overflow-hidden bg-black/40 backdrop-blur-sm">
          <div className="absolute inset-0 overflow-hidden">
            <div className="pointer-events-none fixed inset-y-0 right-0 flex max-w-full pl-10">
              <div className="pointer-events-auto w-screen max-w-md">
                <div className="flex h-full flex-col bg-white dark:bg-zinc-900 shadow-2xl border-l border-zinc-200/50 dark:border-zinc-800/50">
                  
                  {/* Drawer Header */}
                  <div className="flex items-center justify-between px-6 py-5 border-b border-zinc-100 dark:border-zinc-800">
                    <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-50">Shopping Cart</h2>
                    <button
                      onClick={() => setIsCartOpen(false)}
                      className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-500"
                    >
                      <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>

                  {/* Drawer Body */}
                  <div className="flex-1 overflow-y-auto px-6 py-4 divide-y divide-zinc-100 dark:divide-zinc-800">
                    {cart.length === 0 ? (
                      <div className="flex flex-col items-center justify-center h-64 text-center">
                        <svg className="w-16 h-16 text-zinc-300 dark:text-zinc-700 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
                        </svg>
                        <h3 className="font-bold text-zinc-900 dark:text-zinc-50">Your cart is empty</h3>
                        <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">Add items to get started.</p>
                      </div>
                    ) : (
                      cart.map((item) => (
                        <div key={item.product.id} className="py-5 flex items-start gap-4">
                          <div className="flex-1">
                            <h3 className="font-semibold text-zinc-900 dark:text-zinc-50">{item.product.name}</h3>
                            <p className="text-indigo-600 dark:text-indigo-400 text-sm font-semibold mt-1">
                              {formatPrice(item.product.price_paise)}
                            </p>
                            
                            <div className="flex items-center gap-2 mt-4">
                              <button
                                onClick={() => updateQuantity(item.product.id, -1)}
                                className="w-8 h-8 rounded-lg border border-zinc-200 dark:border-zinc-800 flex items-center justify-center hover:bg-zinc-50 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-400"
                              >
                                -
                              </button>
                              <span className="w-8 text-center text-sm font-bold text-zinc-900 dark:text-zinc-50">
                                {item.quantity}
                              </span>
                              <button
                                onClick={() => updateQuantity(item.product.id, 1)}
                                className="w-8 h-8 rounded-lg border border-zinc-200 dark:border-zinc-800 flex items-center justify-center hover:bg-zinc-50 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-400"
                              >
                                +
                              </button>
                            </div>
                          </div>
                          
                          <div className="flex flex-col items-end justify-between h-full gap-4">
                            <span className="font-bold text-zinc-900 dark:text-zinc-50">
                              {formatPrice(item.product.price_paise * item.quantity)}
                            </span>
                            <button
                              onClick={() => removeFromCart(item.product.id)}
                              className="text-xs font-semibold text-red-500 hover:underline"
                            >
                              Remove
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>

                  {/* Drawer Footer */}
                  {cart.length > 0 && (
                    <div className="border-t border-zinc-100 dark:border-zinc-800 px-6 py-6 bg-zinc-50 dark:bg-zinc-900/50">
                      <div className="flex justify-between items-center text-base font-bold text-zinc-900 dark:text-zinc-50 mb-6">
                        <span>Subtotal</span>
                        <span>{formatPrice(cartSubtotal)}</span>
                      </div>
                      
                      <Link
                        href="/checkout"
                        onClick={() => setIsCartOpen(false)}
                        className="w-full h-12 inline-flex items-center justify-center rounded-xl bg-zinc-900 dark:bg-zinc-50 text-white dark:text-zinc-900 font-bold hover:bg-zinc-800 dark:hover:bg-zinc-200 active:scale-[0.98] transition-all"
                      >
                        Proceed to Checkout
                      </Link>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
