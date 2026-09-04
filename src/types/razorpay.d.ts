declare global {
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
    description?: string;
    handler: (response: RazorpayResponse) => Promise<void> | void;
    modal?: { ondismiss?: () => void };
  }

  interface RazorpayInstance {
    open: () => void;
    on: (event: string, callback: (response: RazorpayFailure) => void) => void;
  }

  interface Window {
    Razorpay: new (options: RazorpayOptions) => RazorpayInstance;
  }
}

export {};
