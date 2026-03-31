/**
 * Express-based mock server that mimics the Mainlayer API (https://api.mainlayer.xyz).
 *
 * Designed to be started in tests before each test suite and stopped after.
 * Maintains in-memory state that can be seeded and inspected per-test.
 *
 * @example
 * const server = new MainlayerMockServer();
 * await server.start();
 * // configure env
 * process.env.MAINLAYER_BASE_URL = server.url;
 * // ... run tests ...
 * await server.stop();
 */

import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import { createServer, type Server as HttpServer } from 'http';
import { fixtures } from './fixtures.js';
import type {
  Resource,
  Payment,
  Entitlement,
  Vendor,
  MockServerState,
  EntitlementCheckResponse,
  ApiError,
} from './types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function entitlementKey(resourceId: string, payerWallet: string): string {
  return `${resourceId}::${payerWallet}`;
}

function notFound(res: Response, message = 'Resource not found'): void {
  const body: ApiError = { error: 'not_found', message, status_code: 404 };
  res.status(404).json(body);
}

function badRequest(res: Response, message: string): void {
  const body: ApiError = { error: 'bad_request', message, status_code: 400 };
  res.status(400).json(body);
}

function unauthorized(res: Response): void {
  const body: ApiError = { error: 'unauthorized', message: 'Invalid or missing API key', status_code: 401 };
  res.status(401).json(body);
}

// ---------------------------------------------------------------------------
// MockServerOptions
// ---------------------------------------------------------------------------

export interface MockServerOptions {
  /** TCP port to listen on. Defaults to 0 (OS-assigned random port). */
  port?: number;
  /**
   * When true (default), the server validates the Authorization header
   * and rejects requests without `Bearer <any-non-empty-token>`.
   */
  requireAuth?: boolean;
}

// ---------------------------------------------------------------------------
// MainlayerMockServer
// ---------------------------------------------------------------------------

export class MainlayerMockServer {
  private readonly app: Express;
  private httpServer: HttpServer | null = null;
  private _port: number;
  private readonly requireAuth: boolean;

  private state: MockServerState = {
    resources: new Map(),
    payments: [],
    entitlements: new Map(),
    vendors: new Map(),
  };

  constructor(options: MockServerOptions = {}) {
    this._port = options.port ?? 0;
    this.requireAuth = options.requireAuth ?? true;

    this.app = express();
    this.app.use(express.json());
    this._registerRoutes();
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /** Start listening. Resolves once the server is ready to accept connections. */
  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.httpServer = createServer(this.app);

      this.httpServer.once('error', reject);
      this.httpServer.listen(this._port, '127.0.0.1', () => {
        const addr = this.httpServer!.address();
        if (addr && typeof addr === 'object') {
          this._port = addr.port;
        }
        resolve();
      });
    });
  }

  /** Stop the server and close all connections. */
  async stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.httpServer) {
        resolve();
        return;
      }
      this.httpServer.close((err) => {
        if (err) reject(err);
        else resolve();
        this.httpServer = null;
      });
    });
  }

  /** Base URL of the running server, e.g. `http://127.0.0.1:PORT`. */
  get url(): string {
    if (!this.httpServer) {
      throw new Error('Server is not running. Call start() first.');
    }
    return `http://127.0.0.1:${this._port}`;
  }

  // -------------------------------------------------------------------------
  // State management
  // -------------------------------------------------------------------------

  /**
   * Seed or update an entitlement for a (resource, payer) pair.
   * Use this before tests that check access control.
   */
  setEntitlement(resourceId: string, payerWallet: string, active: boolean): void {
    const key = entitlementKey(resourceId, payerWallet);
    const existing = this.state.entitlements.get(key);
    const entitlement: Entitlement = {
      resource_id: resourceId,
      payer_wallet: payerWallet,
      active,
      granted_at: existing?.granted_at ?? new Date().toISOString(),
      expires_at: existing?.expires_at ?? null,
    };
    this.state.entitlements.set(key, entitlement);
  }

  /**
   * Add a resource to the mock server's catalogue.
   * Returns the fully-populated resource (with generated defaults).
   */
  addResource(resource: Partial<Resource> = {}): Resource {
    const full = fixtures.resource(resource);
    this.state.resources.set(full.id, full);
    return full;
  }

  /**
   * Add a vendor to the mock server's user store.
   * Returns the fully-populated vendor.
   */
  addVendor(vendor: Partial<Vendor> = {}): Vendor {
    const full = fixtures.vendor(vendor);
    this.state.vendors.set(full.id, full);
    return full;
  }

  /** Return all payments recorded by the mock server. */
  getPayments(): Payment[] {
    return [...this.state.payments];
  }

  /** Return all entitlements currently in the mock server. */
  getEntitlements(): Entitlement[] {
    return Array.from(this.state.entitlements.values());
  }

  /**
   * Reset all server state back to empty.
   * Call this in `afterEach` to keep tests isolated.
   */
  reset(): void {
    this.state = {
      resources: new Map(),
      payments: [],
      entitlements: new Map(),
      vendors: new Map(),
    };
  }

  // -------------------------------------------------------------------------
  // Route registration
  // -------------------------------------------------------------------------

  private _authMiddleware = (req: Request, res: Response, next: NextFunction): void => {
    if (!this.requireAuth) {
      next();
      return;
    }
    const auth = req.headers['authorization'];
    if (!auth || !auth.startsWith('Bearer ') || auth.slice(7).trim() === '') {
      unauthorized(res);
      return;
    }
    next();
  };

  private _registerRoutes(): void {
    const r = express.Router();

    r.use(this._authMiddleware);

    // ------------------------------------------------------------------
    // Resources
    // ------------------------------------------------------------------

    // List resources
    r.get('/resources', (_req: Request, res: Response) => {
      const resources = Array.from(this.state.resources.values());
      res.json({ data: resources, total: resources.length });
    });

    // Get a single resource by ID or slug
    r.get('/resources/:id', (req: Request, res: Response) => {
      const { id } = req.params;
      const resource =
        this.state.resources.get(id) ??
        Array.from(this.state.resources.values()).find((r) => r.slug === id);
      if (!resource) {
        notFound(res, `Resource '${id}' not found`);
        return;
      }
      res.json({ data: resource });
    });

    // Create resource
    r.post('/resources', (req: Request, res: Response) => {
      const body = req.body as Partial<Resource>;
      if (!body.slug) {
        badRequest(res, "'slug' is required");
        return;
      }
      // Check slug uniqueness
      const existing = Array.from(this.state.resources.values()).find(
        (r) => r.slug === body.slug
      );
      if (existing) {
        const err: ApiError = {
          error: 'conflict',
          message: `A resource with slug '${body.slug}' already exists`,
          status_code: 409,
        };
        res.status(409).json(err);
        return;
      }
      const resource = this.addResource(body);
      res.status(201).json({ data: resource });
    });

    // Update resource
    r.patch('/resources/:id', (req: Request, res: Response) => {
      const { id } = req.params;
      const existing = this.state.resources.get(id);
      if (!existing) {
        notFound(res, `Resource '${id}' not found`);
        return;
      }
      const updated: Resource = {
        ...existing,
        ...(req.body as Partial<Resource>),
        id: existing.id, // id is immutable
        updated_at: new Date().toISOString(),
      };
      this.state.resources.set(id, updated);
      res.json({ data: updated });
    });

    // Delete resource
    r.delete('/resources/:id', (req: Request, res: Response) => {
      const { id } = req.params;
      if (!this.state.resources.has(id)) {
        notFound(res, `Resource '${id}' not found`);
        return;
      }
      this.state.resources.delete(id);
      res.status(204).send();
    });

    // ------------------------------------------------------------------
    // Entitlements
    // ------------------------------------------------------------------

    // Check entitlement
    r.get('/entitlements/check', (req: Request, res: Response) => {
      const resourceId = req.query['resource_id'] as string | undefined;
      const payerWallet = req.query['payer_wallet'] as string | undefined;

      if (!resourceId || !payerWallet) {
        badRequest(res, "'resource_id' and 'payer_wallet' query parameters are required");
        return;
      }

      const key = entitlementKey(resourceId, payerWallet);
      const entitlement = this.state.entitlements.get(key);

      const response: EntitlementCheckResponse = {
        entitled: entitlement?.active ?? false,
        resource_id: resourceId,
        payer_wallet: payerWallet,
        checked_at: new Date().toISOString(),
      };
      res.json({ data: response });
    });

    // List entitlements for a payer wallet
    r.get('/entitlements', (req: Request, res: Response) => {
      const payerWallet = req.query['payer_wallet'] as string | undefined;
      let entitlements = Array.from(this.state.entitlements.values());
      if (payerWallet) {
        entitlements = entitlements.filter((e) => e.payer_wallet === payerWallet);
      }
      res.json({ data: entitlements, total: entitlements.length });
    });

    // Grant entitlement
    r.post('/entitlements', (req: Request, res: Response) => {
      const { resource_id, payer_wallet, expires_at } = req.body as {
        resource_id?: string;
        payer_wallet?: string;
        expires_at?: string;
      };

      if (!resource_id || !payer_wallet) {
        badRequest(res, "'resource_id' and 'payer_wallet' are required");
        return;
      }

      const key = entitlementKey(resource_id, payer_wallet);
      const entitlement: Entitlement = {
        resource_id,
        payer_wallet,
        active: true,
        granted_at: new Date().toISOString(),
        expires_at: expires_at ?? null,
      };
      this.state.entitlements.set(key, entitlement);
      res.status(201).json({ data: entitlement });
    });

    // Revoke entitlement
    r.delete('/entitlements', (req: Request, res: Response) => {
      const resourceId = req.query['resource_id'] as string | undefined;
      const payerWallet = req.query['payer_wallet'] as string | undefined;

      if (!resourceId || !payerWallet) {
        badRequest(res, "'resource_id' and 'payer_wallet' query parameters are required");
        return;
      }

      const key = entitlementKey(resourceId, payerWallet);
      if (!this.state.entitlements.has(key)) {
        notFound(res, 'Entitlement not found');
        return;
      }

      const entitlement = this.state.entitlements.get(key)!;
      const revoked: Entitlement = { ...entitlement, active: false };
      this.state.entitlements.set(key, revoked);
      res.json({ data: revoked });
    });

    // ------------------------------------------------------------------
    // Payments
    // ------------------------------------------------------------------

    // Initiate payment
    r.post('/payments', (req: Request, res: Response) => {
      const { resource_id, payer_wallet, amount, metadata } = req.body as {
        resource_id?: string;
        payer_wallet?: string;
        amount?: number;
        metadata?: Record<string, unknown>;
      };

      if (!resource_id || !payer_wallet) {
        badRequest(res, "'resource_id' and 'payer_wallet' are required");
        return;
      }

      const resource = this.state.resources.get(resource_id);
      if (!resource) {
        notFound(res, `Resource '${resource_id}' not found`);
        return;
      }

      const payment: Payment = fixtures.payment({
        resource_id,
        payer_wallet,
        vendor_id: resource.vendor_id,
        amount: amount ?? resource.price_per_call,
        currency: 'USD',
        status: 'completed',
        metadata: metadata ?? {},
      });
      this.state.payments.push(payment);

      // Automatically grant entitlement on successful payment
      const key = entitlementKey(resource_id, payer_wallet);
      this.state.entitlements.set(key, {
        resource_id,
        payer_wallet,
        active: true,
        granted_at: new Date().toISOString(),
        expires_at: null,
      });

      res.status(201).json({ data: payment });
    });

    // List payments
    r.get('/payments', (req: Request, res: Response) => {
      let payments = [...this.state.payments];
      const resourceId = req.query['resource_id'] as string | undefined;
      const payerWallet = req.query['payer_wallet'] as string | undefined;
      if (resourceId) payments = payments.filter((p) => p.resource_id === resourceId);
      if (payerWallet) payments = payments.filter((p) => p.payer_wallet === payerWallet);
      res.json({ data: payments, total: payments.length });
    });

    // Get a single payment
    r.get('/payments/:id', (req: Request, res: Response) => {
      const payment = this.state.payments.find((p) => p.id === req.params.id);
      if (!payment) {
        notFound(res, `Payment '${req.params.id}' not found`);
        return;
      }
      res.json({ data: payment });
    });

    // ------------------------------------------------------------------
    // Vendors / Users
    // ------------------------------------------------------------------

    r.get('/users/me', (req: Request, res: Response) => {
      const apiKey = req.headers['authorization']?.slice(7);
      const vendor = Array.from(this.state.vendors.values()).find(
        (v) => v.api_key === apiKey
      );
      if (!vendor) {
        // Return a synthetic user when no vendor matches
        res.json({ data: fixtures.vendor({ api_key: apiKey ?? 'sk_test_mock' }) });
        return;
      }
      res.json({ data: vendor });
    });

    r.get('/users/:id', (req: Request, res: Response) => {
      const vendor = this.state.vendors.get(req.params.id);
      if (!vendor) {
        notFound(res, `User '${req.params.id}' not found`);
        return;
      }
      res.json({ data: vendor });
    });

    // ------------------------------------------------------------------
    // Health
    // ------------------------------------------------------------------

    r.get('/health', (_req: Request, res: Response) => {
      res.json({ status: 'ok', timestamp: new Date().toISOString() });
    });

    this.app.use('/v1', r);

    // Root health — no auth required
    this.app.get('/health', (_req: Request, res: Response) => {
      res.json({ status: 'ok', timestamp: new Date().toISOString() });
    });

    // 404 catch-all
    this.app.use((_req: Request, res: Response) => {
      notFound(res, 'Endpoint not found');
    });
  }
}
