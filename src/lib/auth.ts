import { SupabaseClient } from '@supabase/supabase-js';

export async function verifyMerchantSession(admin: SupabaseClient, token: string): Promise<{ isValid: boolean, code?: number }> {
  const { data: { user }, error } = await admin.auth.getUser(token);
  // console.log('Authenticated user:', user?.id);
  // console.log('Configured merchant:', process.env.MERCHANT_USER_ID);
  if (error || !user) return { isValid: false, code: 401 };
  if (user.id !== process.env.MERCHANT_USER_ID) return { isValid: false, code: 403 };
  return { isValid: true };
}
