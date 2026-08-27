export interface Product {
  id: string;
  name: string;
  price_paise: number;
  description: string | null;
  category: string;
  stock: number;
  created_at: string;
}

export interface CartItem {
  product: Product;
  quantity: number;
}

export interface Checkout {
  id: string;
  status: 'STARTED' | 'PAID' | 'EXPIRED' | 'ABANDONED';
  customer_email: string | null;
  customer_phone: string | null;
  preferred_channel: 'EMAIL' | 'WHATSAPP' | null;
  consent_given: boolean;
  total_amount_paise: number;
  created_at: string;
  updated_at: string;
}

export interface CheckoutItem {
  id: string;
  checkout_id: string;
  product_id: string;
  product_name_snapshot: string;
  unit_price_paise_snapshot: number;
  quantity: number;
  line_total_paise: number;
  created_at: string;
}
export interface RecoveryCase {
  id: string;
  checkout_id: string;
  status: 'DETECTED' | 'ANALYSING' | 'AWAITING_APPROVAL' | 'APPROVED' | 'SCHEDULED' | 'SENT' | 'MONITORING' | 'RECOVERED' | 'REJECTED' | 'ESCALATED' | 'STOPPED' | 'UNRECOVERED' | 'EXPIRED';
  revenue_at_risk_paise: number;
  created_at: string;
  updated_at: string;
}

export interface RecoveryAuditEvent {
  id: string;
  checkout_id: string;
  recovery_case_id: string | null;
  event_type: string;
  payload: Record<string, unknown>;
  created_at: string;
}
