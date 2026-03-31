/**
 * Example: Testing a Mainlayer-integrated API handler using MainlayerMockServer.
 *
 * This file shows the recommended patterns for:
 *  - Starting and stopping the mock server around a test suite
 *  - Seeding entitlements and resources for specific test scenarios
 *  - Asserting that your code correctly gates access behind Mainlayer payments
 *
 * Run with: npx vitest run examples/test-with-mock-server.ts
 * (requires vitest and @mainlayer/testing installed)
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { MainlayerMockServer, fixtures, scenarios } from '../typescript/src/index.js';

// ---------------------------------------------------------------------------
// The "system under test" — a thin wrapper around the Mainlayer API.
// In a real project this would be your SDK client or service class.
// ---------------------------------------------------------------------------

interface MainlayerClient {
  checkEntitlement(resourceId: string, payerWallet: string): Promise<boolean>;
  initiatePayment(resourceId: string, payerWallet: string, amount?: number): Promise<{ id: string; status: string }>;
  getResource(resourceId: string): Promise<{ id: string; slug: string; price_per_call: number }>;
}

function createClient(baseUrl: string, apiKey: string): MainlayerClient {
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };

  return {
    async checkEntitlement(resourceId, payerWallet) {
      const url = new URL(`${baseUrl}/v1/entitlements/check`);
      url.searchParams.set('resource_id', resourceId);
      url.searchParams.set('payer_wallet', payerWallet);
      const res = await fetch(url.toString(), { headers });
      const body = await res.json() as { data: { entitled: boolean } };
      return body.data.entitled;
    },

    async initiatePayment(resourceId, payerWallet, amount) {
      const res = await fetch(`${baseUrl}/v1/payments`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ resource_id: resourceId, payer_wallet: payerWallet, amount }),
      });
      const body = await res.json() as { data: { id: string; status: string } };
      return body.data;
    },

    async getResource(resourceId) {
      const res = await fetch(`${baseUrl}/v1/resources/${resourceId}`, { headers });
      const body = await res.json() as { data: { id: string; slug: string; price_per_call: number } };
      return body.data;
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Mainlayer integration — access gating', () => {
  const mockServer = new MainlayerMockServer();
  let client: MainlayerClient;

  beforeAll(async () => {
    await mockServer.start();
    client = createClient(mockServer.url, 'sk_test_example_key');
  });

  afterAll(async () => {
    await mockServer.stop();
  });

  beforeEach(() => {
    mockServer.reset();
  });

  it('denies access when payer has no entitlement', async () => {
    const resource = mockServer.addResource({ slug: 'premium-api' });
    const entitled = await client.checkEntitlement(resource.id, 'wallet_new_user');
    expect(entitled).toBe(false);
  });

  it('grants access after seeding an entitlement', async () => {
    const resource = mockServer.addResource({ slug: 'premium-api' });
    mockServer.setEntitlement(resource.id, 'wallet_subscribed', true);

    const entitled = await client.checkEntitlement(resource.id, 'wallet_subscribed');
    expect(entitled).toBe(true);
  });

  it('grants access after successful payment', async () => {
    const resource = mockServer.addResource({ slug: 'pay-per-call-api', price_per_call: 0.10 });

    // Before payment — not entitled
    expect(await client.checkEntitlement(resource.id, 'wallet_buyer')).toBe(false);

    // Make payment
    const payment = await client.initiatePayment(resource.id, 'wallet_buyer');
    expect(payment.status).toBe('completed');

    // After payment — entitled
    expect(await client.checkEntitlement(resource.id, 'wallet_buyer')).toBe(true);
  });

  it('records payment amount correctly', async () => {
    const resource = mockServer.addResource({ slug: 'flat-rate-api', price_per_call: 5.00 });
    await client.initiatePayment(resource.id, 'wallet_payer');

    const payments = mockServer.getPayments();
    expect(payments).toHaveLength(1);
    expect(payments[0].amount).toBe(5.00);
  });

  it('uses scenario helpers for complex setup', async () => {
    const { resource, entitlement } = scenarios.paidAndEntitled();
    mockServer.addResource(resource);
    mockServer.setEntitlement(resource.id, entitlement.payer_wallet, true);

    const entitled = await client.checkEntitlement(resource.id, entitlement.payer_wallet);
    expect(entitled).toBe(true);
  });

  it('correctly retrieves resource details', async () => {
    const seeded = mockServer.addResource({ slug: 'data-api', price_per_call: 2.50 });

    const fetched = await client.getResource(seeded.id);
    expect(fetched.slug).toBe('data-api');
    expect(fetched.price_per_call).toBe(2.50);
  });

  it('fixtures produce unique ids per invocation', () => {
    const r1 = fixtures.resource();
    const r2 = fixtures.resource();
    expect(r1.id).not.toBe(r2.id);
  });
});
