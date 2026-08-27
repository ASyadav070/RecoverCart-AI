'use client';
import { useState } from 'react';
import { supabase } from '@/lib/supabase';

export default function MerchantPage() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runScan = async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setError('Not authenticated');
        return;
      }
      const response = await fetch('/api/recovery/scan', {
        method: 'POST',
        headers: { 
          'Authorization': `Bearer ${session.access_token}` 
        },
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Scan failed');
      setResult(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-8 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Merchant Recovery Portal</h1>
      <button 
        onClick={runScan} 
        disabled={loading}
        className="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700"
      >
        {loading ? 'Scanning...' : 'Run Abandonment Scan'}
      </button>
      {error && <p className="mt-4 text-red-500">{error}</p>}
      {result && <pre className="mt-4 bg-zinc-100 p-4">{JSON.stringify(result, null, 2)}</pre>}
    </div>
  );
}