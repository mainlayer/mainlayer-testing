/**
 * Core types for the Mainlayer mock server and test helpers.
 * https://api.mainlayer.fr
 */

export interface Resource {
  id: string;
  slug: string;
  name: string;
  description: string;
  price_per_call: number;
  vendor_id: string;
  active: boolean;
  created_at: string;
  updated_at: string;
  metadata: Record<string, unknown>;
}

export interface Payment {
  id: string;
  resource_id: string;
  payer_wallet: string;
  vendor_id: string;
  amount: number;
  currency: string;
  status: PaymentStatus;
  created_at: string;
  metadata: Record<string, unknown>;
}

export type PaymentStatus = 'pending' | 'completed' | 'failed' | 'refunded';

export interface Entitlement {
  resource_id: string;
  payer_wallet: string;
  active: boolean;
  granted_at: string;
  expires_at: string | null;
}

export interface Vendor {
  id: string;
  name: string;
  email: string;
  api_key: string;
  created_at: string;
  metadata: Record<string, unknown>;
}

export interface PaymentRequest {
  resource_id: string;
  payer_wallet: string;
  amount?: number;
  metadata?: Record<string, unknown>;
}

export interface EntitlementCheckResponse {
  entitled: boolean;
  resource_id: string;
  payer_wallet: string;
  checked_at: string;
}

export interface ApiError {
  error: string;
  message: string;
  status_code: number;
}

export interface MockServerState {
  resources: Map<string, Resource>;
  payments: Payment[];
  entitlements: Map<string, Entitlement>;
  vendors: Map<string, Vendor>;
}
