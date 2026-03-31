/**
 * Test fixtures and data factories for Mainlayer integration testing.
 * Provides deterministic, realistic test data.
 */

import type { Resource, Payment, Entitlement, Vendor, PaymentRequest } from './types.js';

let _idCounter = 0;

function nextId(prefix: string): string {
  _idCounter += 1;
  return `${prefix}_test_${String(_idCounter).padStart(6, '0')}`;
}

/** Reset the internal ID counter. Call between test suites for reproducibility. */
export function resetIdCounter(): void {
  _idCounter = 0;
}

const ISO_NOW = () => new Date().toISOString();

/**
 * Factory functions that produce realistic Mainlayer test data.
 * All factories accept partial overrides — only the fields you care about.
 *
 * @example
 * const res = fixtures.resource({ price_per_call: 0.05 });
 * const pay = fixtures.payment({ resource_id: res.id });
 */
export const fixtures = {
  /**
   * Create a Resource fixture.
   */
  resource(overrides: Partial<Resource> = {}): Resource {
    const id = overrides.id ?? nextId('res');
    return {
      id,
      slug: overrides.slug ?? 'test-resource',
      name: overrides.name ?? 'Test Resource',
      description: overrides.description ?? 'A test resource for integration testing',
      price_per_call: overrides.price_per_call ?? 1.00,
      vendor_id: overrides.vendor_id ?? nextId('usr'),
      active: overrides.active ?? true,
      created_at: overrides.created_at ?? ISO_NOW(),
      updated_at: overrides.updated_at ?? ISO_NOW(),
      metadata: overrides.metadata ?? {},
    };
  },

  /**
   * Create a Payment fixture.
   */
  payment(overrides: Partial<Payment> = {}): Payment {
    return {
      id: overrides.id ?? nextId('pay'),
      resource_id: overrides.resource_id ?? nextId('res'),
      payer_wallet: overrides.payer_wallet ?? 'wallet_test_payer_001',
      vendor_id: overrides.vendor_id ?? nextId('usr'),
      amount: overrides.amount ?? 1.00,
      currency: overrides.currency ?? 'USD',
      status: overrides.status ?? 'completed',
      created_at: overrides.created_at ?? ISO_NOW(),
      metadata: overrides.metadata ?? {},
    };
  },

  /**
   * Create an Entitlement fixture.
   */
  entitlement(overrides: Partial<Entitlement> = {}): Entitlement {
    return {
      resource_id: overrides.resource_id ?? nextId('res'),
      payer_wallet: overrides.payer_wallet ?? 'wallet_test_payer_001',
      active: overrides.active ?? true,
      granted_at: overrides.granted_at ?? ISO_NOW(),
      expires_at: overrides.expires_at !== undefined ? overrides.expires_at : null,
    };
  },

  /**
   * Create a Vendor fixture.
   */
  vendor(overrides: Partial<Vendor> = {}): Vendor {
    return {
      id: overrides.id ?? nextId('usr'),
      name: overrides.name ?? 'Test Vendor',
      email: overrides.email ?? 'vendor@example.com',
      api_key: overrides.api_key ?? 'sk_test_' + Math.random().toString(36).slice(2, 18),
      created_at: overrides.created_at ?? ISO_NOW(),
      metadata: overrides.metadata ?? {},
    };
  },

  /**
   * Create a PaymentRequest fixture.
   */
  paymentRequest(overrides: Partial<PaymentRequest> = {}): PaymentRequest {
    return {
      resource_id: overrides.resource_id ?? nextId('res'),
      payer_wallet: overrides.payer_wallet ?? 'wallet_test_payer_001',
      amount: overrides.amount,
      metadata: overrides.metadata ?? {},
    };
  },
};

/**
 * Convenience collections of pre-built fixtures for common test scenarios.
 */
export const scenarios = {
  /** A vendor with two resources — one active, one inactive. */
  vendorWithResources() {
    const vendor = fixtures.vendor();
    const activeResource = fixtures.resource({ vendor_id: vendor.id, active: true });
    const inactiveResource = fixtures.resource({ vendor_id: vendor.id, active: false, slug: 'inactive-resource' });
    return { vendor, activeResource, inactiveResource };
  },

  /** A resource with a completed payment and granted entitlement. */
  paidAndEntitled() {
    const resource = fixtures.resource();
    const payment = fixtures.payment({
      resource_id: resource.id,
      vendor_id: resource.vendor_id,
      status: 'completed',
    });
    const entitlement = fixtures.entitlement({
      resource_id: resource.id,
      payer_wallet: payment.payer_wallet,
      active: true,
    });
    return { resource, payment, entitlement };
  },

  /** A failed payment scenario — entitlement should not be granted. */
  failedPayment() {
    const resource = fixtures.resource();
    const payment = fixtures.payment({
      resource_id: resource.id,
      vendor_id: resource.vendor_id,
      status: 'failed',
    });
    return { resource, payment };
  },
};
