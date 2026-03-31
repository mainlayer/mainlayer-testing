/**
 * Tests for MainlayerMockServer.
 * Covers all major API surfaces: resources, entitlements, payments, and edge cases.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { MainlayerMockServer } from '../src/mock-server.js';
import { fixtures, scenarios, resetIdCounter } from '../src/fixtures.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const API_KEY = 'sk_test_integration_key';
const AUTH = { Authorization: `Bearer ${API_KEY}` };
const JSON_HEADERS = { ...AUTH, 'Content-Type': 'application/json' };

async function get(url: string, headers: Record<string, string> = AUTH) {
  return fetch(url, { headers });
}

async function post(url: string, body: unknown, headers: Record<string, string> = JSON_HEADERS) {
  return fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
}

async function patch(url: string, body: unknown, headers: Record<string, string> = JSON_HEADERS) {
  return fetch(url, { method: 'PATCH', headers, body: JSON.stringify(body) });
}

async function del(url: string, headers: Record<string, string> = AUTH) {
  return fetch(url, { method: 'DELETE', headers });
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let server: MainlayerMockServer;

beforeAll(async () => {
  server = new MainlayerMockServer({ requireAuth: true });
  await server.start();
});

afterAll(async () => {
  await server.stop();
});

beforeEach(() => {
  server.reset();
  resetIdCounter();
});

// ---------------------------------------------------------------------------
// Server lifecycle
// ---------------------------------------------------------------------------

describe('Server lifecycle', () => {
  it('exposes a url after start()', () => {
    expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  });

  it('responds to root health check without auth', async () => {
    const res = await fetch(`${server.url}/health`);
    expect(res.status).toBe(200);
    const body = await res.json() as { status: string };
    expect(body.status).toBe('ok');
  });

  it('responds to /v1/health with auth', async () => {
    const res = await get(`${server.url}/v1/health`);
    expect(res.status).toBe(200);
    const body = await res.json() as { status: string };
    expect(body.status).toBe('ok');
  });
});

// ---------------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------------

describe('Authentication', () => {
  it('rejects requests without Authorization header', async () => {
    const res = await fetch(`${server.url}/v1/resources`);
    expect(res.status).toBe(401);
  });

  it('rejects requests with empty Bearer token', async () => {
    const res = await fetch(`${server.url}/v1/resources`, {
      headers: { Authorization: 'Bearer ' },
    });
    expect(res.status).toBe(401);
  });

  it('accepts requests with a non-empty Bearer token', async () => {
    const res = await get(`${server.url}/v1/resources`);
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Resources
// ---------------------------------------------------------------------------

describe('Resources', () => {
  it('returns an empty list when no resources are seeded', async () => {
    const res = await get(`${server.url}/v1/resources`);
    expect(res.status).toBe(200);
    const body = await res.json() as { data: unknown[]; total: number };
    expect(body.data).toEqual([]);
    expect(body.total).toBe(0);
  });

  it('returns seeded resources', async () => {
    server.addResource({ slug: 'alpha', name: 'Alpha' });
    server.addResource({ slug: 'beta', name: 'Beta' });
    const res = await get(`${server.url}/v1/resources`);
    const body = await res.json() as { data: unknown[]; total: number };
    expect(body.total).toBe(2);
  });

  it('fetches a single resource by id', async () => {
    const resource = server.addResource({ slug: 'my-resource' });
    const res = await get(`${server.url}/v1/resources/${resource.id}`);
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { id: string } };
    expect(body.data.id).toBe(resource.id);
  });

  it('fetches a single resource by slug', async () => {
    server.addResource({ slug: 'lookup-by-slug' });
    const res = await get(`${server.url}/v1/resources/lookup-by-slug`);
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { slug: string } };
    expect(body.data.slug).toBe('lookup-by-slug');
  });

  it('returns 404 for unknown resource id', async () => {
    const res = await get(`${server.url}/v1/resources/res_nonexistent`);
    expect(res.status).toBe(404);
  });

  it('creates a resource via POST', async () => {
    const res = await post(`${server.url}/v1/resources`, { slug: 'new-res', name: 'New Resource' });
    expect(res.status).toBe(201);
    const body = await res.json() as { data: { slug: string } };
    expect(body.data.slug).toBe('new-res');
  });

  it('returns 400 when creating resource without slug', async () => {
    const res = await post(`${server.url}/v1/resources`, { name: 'No Slug' });
    expect(res.status).toBe(400);
  });

  it('returns 409 when creating resource with duplicate slug', async () => {
    server.addResource({ slug: 'dupe-slug' });
    const res = await post(`${server.url}/v1/resources`, { slug: 'dupe-slug' });
    expect(res.status).toBe(409);
  });

  it('updates a resource via PATCH', async () => {
    const resource = server.addResource({ slug: 'patch-me', name: 'Before' });
    const res = await patch(`${server.url}/v1/resources/${resource.id}`, { name: 'After' });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { name: string; id: string } };
    expect(body.data.name).toBe('After');
    expect(body.data.id).toBe(resource.id); // id is immutable
  });

  it('returns 404 when patching unknown resource', async () => {
    const res = await patch(`${server.url}/v1/resources/res_missing`, { name: 'X' });
    expect(res.status).toBe(404);
  });

  it('deletes a resource via DELETE', async () => {
    const resource = server.addResource({ slug: 'delete-me' });
    const res = await del(`${server.url}/v1/resources/${resource.id}`);
    expect(res.status).toBe(204);
    const checkRes = await get(`${server.url}/v1/resources/${resource.id}`);
    expect(checkRes.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Entitlements
// ---------------------------------------------------------------------------

describe('Entitlements', () => {
  it('returns entitled=false when no entitlement exists', async () => {
    const res = await get(
      `${server.url}/v1/entitlements/check?resource_id=res_x&payer_wallet=wallet_y`
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { entitled: boolean } };
    expect(body.data.entitled).toBe(false);
  });

  it('returns entitled=true after setEntitlement', async () => {
    server.setEntitlement('res_123', 'wallet_abc', true);
    const res = await get(
      `${server.url}/v1/entitlements/check?resource_id=res_123&payer_wallet=wallet_abc`
    );
    const body = await res.json() as { data: { entitled: boolean } };
    expect(body.data.entitled).toBe(true);
  });

  it('returns entitled=false after setEntitlement with active=false', async () => {
    server.setEntitlement('res_123', 'wallet_abc', false);
    const res = await get(
      `${server.url}/v1/entitlements/check?resource_id=res_123&payer_wallet=wallet_abc`
    );
    const body = await res.json() as { data: { entitled: boolean } };
    expect(body.data.entitled).toBe(false);
  });

  it('returns 400 when check is missing resource_id', async () => {
    const res = await get(`${server.url}/v1/entitlements/check?payer_wallet=wallet_x`);
    expect(res.status).toBe(400);
  });

  it('grants an entitlement via POST', async () => {
    const res = await post(`${server.url}/v1/entitlements`, {
      resource_id: 'res_grant',
      payer_wallet: 'wallet_grant',
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { data: { active: boolean } };
    expect(body.data.active).toBe(true);
  });

  it('revokes an entitlement via DELETE', async () => {
    server.setEntitlement('res_revoke', 'wallet_revoke', true);
    const res = await del(
      `${server.url}/v1/entitlements?resource_id=res_revoke&payer_wallet=wallet_revoke`
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { active: boolean } };
    expect(body.data.active).toBe(false);
  });

  it('lists all entitlements', async () => {
    server.setEntitlement('res_a', 'wallet_1', true);
    server.setEntitlement('res_b', 'wallet_1', true);
    const res = await get(`${server.url}/v1/entitlements?payer_wallet=wallet_1`);
    const body = await res.json() as { data: unknown[]; total: number };
    expect(body.total).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

describe('Payments', () => {
  it('creates a payment and grants entitlement', async () => {
    const resource = server.addResource({ slug: 'paid-resource', price_per_call: 2.50 });
    const res = await post(`${server.url}/v1/payments`, {
      resource_id: resource.id,
      payer_wallet: 'wallet_buyer',
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { data: { status: string; amount: number } };
    expect(body.data.status).toBe('completed');
    expect(body.data.amount).toBe(2.50);

    // Entitlement should now be active
    const entCheck = await get(
      `${server.url}/v1/entitlements/check?resource_id=${resource.id}&payer_wallet=wallet_buyer`
    );
    const entBody = await entCheck.json() as { data: { entitled: boolean } };
    expect(entBody.data.entitled).toBe(true);
  });

  it('records payment in getPayments()', async () => {
    const resource = server.addResource({ slug: 'trackable' });
    await post(`${server.url}/v1/payments`, {
      resource_id: resource.id,
      payer_wallet: 'wallet_track',
    });
    const payments = server.getPayments();
    expect(payments).toHaveLength(1);
    expect(payments[0].resource_id).toBe(resource.id);
  });

  it('returns 400 when creating payment without payer_wallet', async () => {
    const resource = server.addResource({ slug: 'missing-wallet' });
    const res = await post(`${server.url}/v1/payments`, { resource_id: resource.id });
    expect(res.status).toBe(400);
  });

  it('returns 404 when paying for unknown resource', async () => {
    const res = await post(`${server.url}/v1/payments`, {
      resource_id: 'res_ghost',
      payer_wallet: 'wallet_x',
    });
    expect(res.status).toBe(404);
  });

  it('fetches a single payment by id', async () => {
    const resource = server.addResource({ slug: 'fetch-payment' });
    const createRes = await post(`${server.url}/v1/payments`, {
      resource_id: resource.id,
      payer_wallet: 'wallet_single',
    });
    const { data: created } = await createRes.json() as { data: { id: string } };

    const res = await get(`${server.url}/v1/payments/${created.id}`);
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { id: string } };
    expect(body.data.id).toBe(created.id);
  });

  it('lists payments filtered by resource_id', async () => {
    const r1 = server.addResource({ slug: 'resource-one' });
    const r2 = server.addResource({ slug: 'resource-two' });
    await post(`${server.url}/v1/payments`, { resource_id: r1.id, payer_wallet: 'w1' });
    await post(`${server.url}/v1/payments`, { resource_id: r2.id, payer_wallet: 'w2' });

    const res = await get(`${server.url}/v1/payments?resource_id=${r1.id}`);
    const body = await res.json() as { data: unknown[]; total: number };
    expect(body.total).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// State reset
// ---------------------------------------------------------------------------

describe('reset()', () => {
  it('clears all state between tests', async () => {
    server.addResource({ slug: 'temporary' });
    server.setEntitlement('res_temp', 'wallet_temp', true);
    server.reset();

    const res = await get(`${server.url}/v1/resources`);
    const body = await res.json() as { data: unknown[] };
    expect(body.data).toHaveLength(0);
    expect(server.getPayments()).toHaveLength(0);
    expect(server.getEntitlements()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Scenario helpers
// ---------------------------------------------------------------------------

describe('scenarios', () => {
  it('vendorWithResources creates correct structure', () => {
    const { vendor, activeResource, inactiveResource } = scenarios.vendorWithResources();
    expect(activeResource.vendor_id).toBe(vendor.id);
    expect(inactiveResource.vendor_id).toBe(vendor.id);
    expect(activeResource.active).toBe(true);
    expect(inactiveResource.active).toBe(false);
  });

  it('paidAndEntitled creates matching ids', () => {
    const { resource, payment, entitlement } = scenarios.paidAndEntitled();
    expect(payment.resource_id).toBe(resource.id);
    expect(entitlement.resource_id).toBe(resource.id);
    expect(payment.payer_wallet).toBe(entitlement.payer_wallet);
  });

  it('failedPayment creates status=failed payment', () => {
    const { payment } = scenarios.failedPayment();
    expect(payment.status).toBe('failed');
  });
});

// ---------------------------------------------------------------------------
// 404 catch-all
// ---------------------------------------------------------------------------

describe('404 catch-all', () => {
  it('returns 404 for unknown endpoints', async () => {
    const res = await get(`${server.url}/v1/nonexistent-endpoint`);
    expect(res.status).toBe(404);
  });
});
