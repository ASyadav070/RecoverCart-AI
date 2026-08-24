import { supabase } from '@/lib/supabase';
import { Product } from '@/types/store';
import StoreFront from '@/components/StoreFront';

// Force dynamic rendering so that inventory is always up-to-date
export const dynamic = 'force-dynamic';

export default async function HomePage() {
  // Fetch seeded products from Supabase
  const { data: dbProducts, error } = await supabase
    .from('products')
    .select('*')
    .order('name', { ascending: true });

  if (error) {
    console.error('Failed to load products:', error);
  }

  const products: Product[] = dbProducts || [];

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <main className="max-w-7xl mx-auto py-12 px-4 sm:px-6 lg:px-8">
        <header className="mb-12 border-b border-zinc-200/50 dark:border-zinc-800/50 pb-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-4xl font-extrabold tracking-tight text-zinc-900 dark:text-zinc-50">
              RecoverCart <span className="text-indigo-600 dark:text-indigo-400">Demo Store</span>
            </h1>
            <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
              Simulate customer cart additions, guest checkouts, and abandonment scenarios.
            </p>
          </div>
        </header>

        {products.length === 0 ? (
          <div className="text-center py-20 bg-white dark:bg-zinc-900 rounded-2xl border border-dashed border-zinc-200 dark:border-zinc-800">
            <h2 className="text-xl font-bold text-zinc-950 dark:text-zinc-50">No products found</h2>
            <p className="text-zinc-500 dark:text-zinc-400 mt-2">
              Please check if database migrations were applied successfully.
            </p>
          </div>
        ) : (
          <StoreFront initialProducts={products} />
        )}
      </main>
    </div>
  );
}
