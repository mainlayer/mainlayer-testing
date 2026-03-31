/**
 * MSW (Mock Service Worker) interceptors for Mainlayer API routes.
 *
 * Works in both browser (via Service Worker) and Node.js (via msw/node).
 * Use these handlers when you cannot spin up a full mock server — e.g.
 * unit tests with jsdom, Storybook, or Vitest browser mode.
 *
 * @example Node (Jest / Vitest)
 * ```ts
 * import { setupServer } from 'msw/node';
 * import { createHandlers } from '@mainlayer/testing/interceptors';
 *
 * const server = setupServer(...createHandlers());
 * beforeAll(() => server.listen());
 * afterEach(() => server.resetHandlers());
 * afterAll(() => server.close());
 * ```
 *
 * @example Browser (Storybook / Vitest browser)
 * ```ts
 * import { setupWorker } from 'msw/browser';
 * import { createHandlers } from '@mainlayer/testing/interceptors';
 *
 * const worker = setupWorker(...createHandlers());
 * worker.start();
 * ```
 */

import { http, HttpResponse, type HttpHandler } from 'msw';
import { fixtures } from './fixtures.js';
import type { Resource, Payment, Entitlement } from './types.js';

// ---------------------------------------------------------------------------
// In-memory store (shared across all handlers for one test run)
// ---------------------------------------------------------------------------

export interface InterceptorStore {
  resources: Map<string, Resource>;
  payments: Payment[];
  entitlements: Map<string, Entitlement>;
}

function createStore(): InterceptorStore {
  return {
    resources: new Map(),
    payments: [],
    entitlements: new Map(),
  };
}

function entitlementKey(resourceId: string, payerWallet: string): string {
  return `${resourceId}::${payerWallet}`;
}

// ---------------------------------------------------------------------------
// Handler factory
// ---------------------------------------------------------------------------

export interface CreateHandlersOptions {
  /** Mainlayer base URL to intercept. Defaults to https://api.mainlayer.fr */
  baseUrl?: string;
  /** Provide a store to pre-seed or inspect intercepted state. */
  store?: InterceptorStore;
}

/**
 * Create MSW handlers that mock the Mainlayer API.
 *
 * @param options - Configuration for base URL and optional shared store.
 * @returns An array of MSW request handlers ready to pass to `setupServer` or `setupWorker`.
 */
export function createHandlers(options: CreateHandlersOptions = {}): HttpHandler[] {
  const base = (options.baseUrl ?? 'https://api.mainlayer.fr').replace(/\/$/, '');
  const store = options.store ?? createStore();

  return [
    // ------------------------------------------------------------------
    // Health
    // ------------------------------------------------------------------

    http.get(`${base}/health`, () =>
      HttpResponse.json({ status: 'ok', timestamp: new Date().toISOString() })
    ),

    // ------------------------------------------------------------------
    // Resources — list
    // ------------------------------------------------------------------

    http.get(`${base}/v1/resources`, () => {
      const resources = Array.from(store.resources.values());
      return HttpResponse.json({ data: resources, total: resources.length });
    }),

    // ------------------------------------------------------------------
    // Resources — single
    // ------------------------------------------------------------------

    http.get(`${base}/v1/resources/:id`, ({ params }) => {
      const id = params['id'] as string;
      const resource =
        store.resources.get(id) ??
        Array.from(store.resources.values()).find((r) => r.slug === id);
      if (!resource) {
        return HttpResponse.json(
          { error: 'not_found', message: `Resource '${id}' not found`, status_code: 404 },
          { status: 404 }
        );
      }
      return HttpResponse.json({ data: resource });
    }),

    // ------------------------------------------------------------------
    // Resources — create
    // ------------------------------------------------------------------

    http.post(`${base}/v1/resources`, async ({ request }) => {
      const body = (await request.json()) as Partial<Resource>;
      if (!body.slug) {
        return HttpResponse.json(
          { error: 'bad_request', message: "'slug' is required", status_code: 400 },
          { status: 400 }
        );
      }
      const resource = fixtures.resource(body);
      store.resources.set(resource.id, resource);
      return HttpResponse.json({ data: resource }, { status: 201 });
    }),

    // ------------------------------------------------------------------
    // Entitlements — check
    // ------------------------------------------------------------------

    http.get(`${base}/v1/entitlements/check`, ({ request }) => {
      const url = new URL(request.url);
      const resourceId = url.searchParams.get('resource_id');
      const payerWallet = url.searchParams.get('payer_wallet');

      if (!resourceId || !payerWallet) {
        return HttpResponse.json(
          {
            error: 'bad_request',
            message: "'resource_id' and 'payer_wallet' query parameters are required",
            status_code: 400,
          },
          { status: 400 }
        );
      }

      const key = entitlementKey(resourceId, payerWallet);
      const entitlement = store.entitlements.get(key);

      return HttpResponse.json({
        data: {
          entitled: entitlement?.active ?? false,
          resource_id: resourceId,
          payer_wallet: payerWallet,
          checked_at: new Date().toISOString(),
        },
      });
    }),

    // ------------------------------------------------------------------
    // Entitlements — list
    // ------------------------------------------------------------------

    http.get(`${base}/v1/entitlements`, ({ request }) => {
      const url = new URL(request.url);
      const payerWallet = url.searchParams.get('payer_wallet');
      let entitlements = Array.from(store.entitlements.values());
      if (payerWallet) {
        entitlements = entitlements.filter((e) => e.payer_wallet === payerWallet);
      }
      return HttpResponse.json({ data: entitlements, total: entitlements.length });
    }),

    // ------------------------------------------------------------------
    // Entitlements — grant
    // ------------------------------------------------------------------

    http.post(`${base}/v1/entitlements`, async ({ request }) => {
      const body = (await request.json()) as {
        resource_id?: string;
        payer_wallet?: string;
        expires_at?: string;
      };
      if (!body.resource_id || !body.payer_wallet) {
        return HttpResponse.json(
          {
            error: 'bad_request',
            message: "'resource_id' and 'payer_wallet' are required",
            status_code: 400,
          },
          { status: 400 }
        );
      }
      const key = entitlementKey(body.resource_id, body.payer_wallet);
      const entitlement: Entitlement = {
        resource_id: body.resource_id,
        payer_wallet: body.payer_wallet,
        active: true,
        granted_at: new Date().toISOString(),
        expires_at: body.expires_at ?? null,
      };
      store.entitlements.set(key, entitlement);
      return HttpResponse.json({ data: entitlement }, { status: 201 });
    }),

    // ------------------------------------------------------------------
    // Payments — create
    // ------------------------------------------------------------------

    http.post(`${base}/v1/payments`, async ({ request }) => {
      const body = (await request.json()) as {
        resource_id?: string;
        payer_wallet?: string;
        amount?: number;
        metadata?: Record<string, unknown>;
      };
      if (!body.resource_id || !body.payer_wallet) {
        return HttpResponse.json(
          {
            error: 'bad_request',
            message: "'resource_id' and 'payer_wallet' are required",
            status_code: 400,
          },
          { status: 400 }
        );
      }
      const resource = store.resources.get(body.resource_id);
      const payment = fixtures.payment({
        resource_id: body.resource_id,
        payer_wallet: body.payer_wallet,
        vendor_id: resource?.vendor_id ?? 'usr_test_unknown',
        amount: body.amount ?? resource?.price_per_call ?? 1.0,
        status: 'completed',
        metadata: body.metadata ?? {},
      });
      store.payments.push(payment);

      // Grant entitlement
      const key = entitlementKey(body.resource_id, body.payer_wallet);
      store.entitlements.set(key, {
        resource_id: body.resource_id,
        payer_wallet: body.payer_wallet,
        active: true,
        granted_at: new Date().toISOString(),
        expires_at: null,
      });

      return HttpResponse.json({ data: payment }, { status: 201 });
    }),

    // ------------------------------------------------------------------
    // Payments — list
    // ------------------------------------------------------------------

    http.get(`${base}/v1/payments`, ({ request }) => {
      const url = new URL(request.url);
      const resourceId = url.searchParams.get('resource_id');
      const payerWallet = url.searchParams.get('payer_wallet');
      let payments = [...store.payments];
      if (resourceId) payments = payments.filter((p) => p.resource_id === resourceId);
      if (payerWallet) payments = payments.filter((p) => p.payer_wallet === payerWallet);
      return HttpResponse.json({ data: payments, total: payments.length });
    }),

    // ------------------------------------------------------------------
    // Payments — single
    // ------------------------------------------------------------------

    http.get(`${base}/v1/payments/:id`, ({ params }) => {
      const id = params['id'] as string;
      const payment = store.payments.find((p) => p.id === id);
      if (!payment) {
        return HttpResponse.json(
          { error: 'not_found', message: `Payment '${id}' not found`, status_code: 404 },
          { status: 404 }
        );
      }
      return HttpResponse.json({ data: payment });
    }),
  ];
}

/**
 * Create a fresh interceptor store.
 * Pass this to `createHandlers` and use it to pre-seed or inspect state in tests.
 */
export { createStore };
