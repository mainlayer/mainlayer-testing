/**
 * @mainlayer/testing — TypeScript entry point
 *
 * Mock server and test helpers for Mainlayer payment infrastructure.
 * https://api.mainlayer.fr
 */

export { MainlayerMockServer } from './mock-server.js';
export type { MockServerOptions } from './mock-server.js';

export { fixtures, scenarios, resetIdCounter } from './fixtures.js';

export { createHandlers, createStore } from './interceptors.js';
export type { CreateHandlersOptions, InterceptorStore } from './interceptors.js';

export type {
  Resource,
  Payment,
  PaymentStatus,
  Entitlement,
  Vendor,
  PaymentRequest,
  EntitlementCheckResponse,
  ApiError,
  MockServerState,
} from './types.js';
