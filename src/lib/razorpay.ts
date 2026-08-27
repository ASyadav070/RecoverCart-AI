import "server-only";
import Razorpay from 'razorpay';

let rzpClient: Razorpay | null = null;

export function getRazorpayClient(): Razorpay {
  if (!process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
    throw new Error('Razorpay credentials are not configured');
  }
  if (!rzpClient) {
    rzpClient = new Razorpay({
      key_id: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET,
    });
  }
  return rzpClient;
}
