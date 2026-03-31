# mainlayer-testing

Mock server and test helpers for [Mainlayer](https://api.mainlayer.fr) integrations — available in **TypeScript/Node.js** and **Python**.

Write fast, deterministic integration tests against a **local mock** that mirrors the Mainlayer API without making real network calls or incurring charges.

---

## Installation

### TypeScript / Node.js

```bash
npm install --save-dev @mainlayer/testing
# or
yarn add --dev @mainlayer/testing
pnpm add -D @mainlayer/testing
```

Optional peer dependency for browser/jsdom testing:

```bash
npm install --save-dev msw
```

### Python

```bash
# Basic installation
pip install mainlayer-testing

# With pytest plugin (recommended)
pip install "mainlayer-testing[pytest]"

# With requests for examples
pip install "mainlayer-testing[pytest,requests]"
```

---

## Quick start

### TypeScript (Vitest / Jest)

```typescript
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { MainlayerMockServer } from '@mainlayer/testing';

describe('Payment gating', () => {
  const server = new MainlayerMockServer();

  beforeAll(() => server.start());
  afterAll(() => server.stop());
  beforeEach(() => server.reset());

  it('grants access after payment', async () => {
    // Setup: create a resource
    const resource = server.addResource({
      slug: 'my-api',
      price_per_call: 1.00,
    });

    // Before payment — not entitled
    const res1 = await fetch(
      `${server.url}/v1/entitlements/check?resource_id=${resource.id}&payer_wallet=wallet_abc`,
      { headers: { Authorization: 'Bearer sk_test_key' } }
    );
    expect((await res1.json()).data.entitled).toBe(false);

    // Make a payment
    const payRes = await fetch(`${server.url}/v1/payments`, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer sk_test_key',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        resource_id: resource.id,
        payer_wallet: 'wallet_abc',
        amount_usd: 10.00,
      }),
    });
    expect(payRes.status).toBe(201);

    // After payment — entitled
    const res2 = await fetch(
      `${server.url}/v1/entitlements/check?resource_id=${resource.id}&payer_wallet=wallet_abc`,
      { headers: { Authorization: 'Bearer sk_test_key' } }
    );
    expect((await res2.json()).data.entitled).toBe(true);
  });
});
```

### Python (pytest)

```python
import requests
import pytest

def test_access_gated_behind_payment(mainlayer_server):
    """Test that access is granted after payment."""
    # Setup: create a resource
    resource = mainlayer_server.add_resource(
        slug="my-api",
        price_per_call=1.00,
    )

    headers = {"Authorization": "Bearer sk_test_key"}

    # Before payment — not entitled
    resp1 = requests.get(
        f"{mainlayer_server.url}/v1/entitlements/check",
        params={
            "resource_id": resource["id"],
            "payer_wallet": "wallet_abc"
        },
        headers=headers,
    )
    assert resp1.json()["data"]["entitled"] is False

    # Make a payment
    pay_resp = requests.post(
        f"{mainlayer_server.url}/v1/payments",
        json={
            "resource_id": resource["id"],
            "payer_wallet": "wallet_abc",
            "amount_usd": 10.00,
        },
        headers={**headers, "Content-Type": "application/json"},
    )
    assert pay_resp.status_code == 201

    # After payment — entitled
    resp2 = requests.get(
        f"{mainlayer_server.url}/v1/entitlements/check",
        params={
            "resource_id": resource["id"],
            "payer_wallet": "wallet_abc"
        },
        headers=headers,
    )
    assert resp2.json()["data"]["entitled"] is True
```

---

## What's included

| Feature | TypeScript | Python |
|---|---|---|
| In-process mock HTTP server | `MainlayerMockServer` (Express) | `MainlayerMockServer` (Flask) |
| Resource/payment management | `addResource()`, `getPayments()` | Same API |
| Entitlement control | `setEntitlement()`, `revokeEntitlement()` | Same API |
| Test data factories | `fixtures.resource()`, `fixtures.payment()` | Same API |
| Pre-built scenarios | `scenarios.vendorWithResources()` | Same API |
| MSW interceptors | `createHandlers()` (browser/jsdom) | — |
| pytest auto-fixtures | — | `mainlayer_server`, `mainlayer_env` |
| State inspection | `getPayments()`, `getResources()` | Same API |

---

## TypeScript / Node.js

### Server lifecycle

```typescript
import { MainlayerMockServer } from '@mainlayer/testing';

// Create once per test suite
const server = new MainlayerMockServer();

// Start before tests
await server.start();  // Binds to random available port

// Reset between tests
server.reset();  // Clears all state but keeps running

// Stop after tests
await server.stop();

// Get the URL
console.log(server.url);  // http://127.0.0.1:12345
```

### State management

```typescript
import { MainlayerMockServer } from '@mainlayer/testing';

const server = new MainlayerMockServer();
await server.start();

// Create a resource
const resource = server.addResource({
  slug: 'my-api',
  name: 'My API',
  price_per_call: 0.50,
  description: 'Test resource',
});

// Grant an entitlement manually (without payment)
server.setEntitlement(resource.id, 'wallet_premium', true);

// Check current state
const entitlements = server.getEntitlements();
const payments = server.getPayments();
const resources = server.getResources();

console.log(resources[0].id);      // res_test_000001
console.log(payments.length);      // 0 (no payments yet)
console.log(entitlements[0].payer_wallet);  // wallet_premium
```

### Fixtures (test data factories)

```typescript
import { fixtures, scenarios } from '@mainlayer/testing';

// Individual factories — all fields have sensible defaults
const resource = fixtures.resource({
  slug: 'advanced-api',
  price_per_call: 2.50,
});

const payment = fixtures.payment({
  resource_id: resource.id,
  payer_wallet: 'wallet_123',
  amount_usd: 100.00,
  status: 'completed',
});

const vendor = fixtures.vendor({
  name: 'Acme Corp',
  email: 'billing@acme.com',
});

// Pre-built scenarios (multi-entity setups)
const { vendor: v, activeResource, inactiveResource } = scenarios.vendorWithResources();

const { resource: r, payment: p, entitlement: e } = scenarios.paidAndEntitled();
console.log(e.entitled);  // true — this wallet has access
```

### MSW interceptors (browser/jsdom testing)

Use for Storybook, Vitest browser mode, or jsdom:

```typescript
import { setupServer } from 'msw/node';
import { createHandlers, createStore } from '@mainlayer/testing/interceptors';

// Optional: share state across tests
const store = createStore();

// Setup MSW with Mainlayer handlers
const mswServer = setupServer(...createHandlers({ store }));

beforeAll(() => mswServer.listen());
afterEach(() => mswServer.resetHandlers());
afterAll(() => mswServer.close());

// Pre-seed resources
store.resources.set('res_test_000001', {
  id: 'res_test_000001',
  slug: 'gated-api',
  price_per_call: 1.00,
  active: true,
});

// Use in component test
it('shows locked state before payment', async () => {
  const { getByText } = render(<MyComponent />);
  expect(getByText(/locked/i)).toBeInTheDocument();
});
```

Custom base URL:

```typescript
createHandlers({
  baseUrl: 'https://api.staging.mainlayer.fr',
  store,
})
```

---

## Python

### Server lifecycle

```python
from mainlayer_testing import MainlayerMockServer

# Start server
server = MainlayerMockServer()
server.start()

# Server URL
print(server.url)  # http://127.0.0.1:12345

# Reset between tests
server.reset()

# Stop server
server.stop()
```

### pytest fixtures (auto-registered)

The pytest plugin auto-registers fixtures with no configuration needed:

```python
# test_my_service.py
import requests

def test_payment_flow(mainlayer_server):
    """mainlayer_server fixture auto-started & auto-reset."""
    resource = mainlayer_server.add_resource(slug="api", price_per_call=1.00)

    # Make request to mock
    resp = requests.get(
        f"{mainlayer_server.url}/v1/resources/{resource['id']}",
        headers={"Authorization": "Bearer sk_test"},
    )
    assert resp.status_code == 200
```

**Available fixtures:**

| Fixture | Scope | Notes |
|---|---|---|
| `mainlayer_server` | function | New server per test, auto-reset |
| `mainlayer_url` | function | String URL only (no server) |
| `mainlayer_env` | function | Sets `MAINLAYER_BASE_URL` env var |
| `mainlayer_server_session` | session | Reused across tests (no reset) |

### State management

```python
from mainlayer_testing import MainlayerMockServer

server = MainlayerMockServer()
server.start()

# Create resources
resource = server.add_resource(
    slug="my-api",
    name="My API",
    price_per_call=0.50,
)

# Grant entitlements
server.set_entitlement(resource["id"], "wallet_abc", True)

# Check current state
payments = server.get_payments()
entitlements = server.get_entitlements()
resources = server.get_resources()

print(resources[0]["slug"])  # my-api
print(entitlements[0]["entitled"])  # True
```

### Fixtures & scenarios

```python
from mainlayer_testing.fixtures import fixtures, scenarios

# Individual factories
resource = fixtures.resource(
    slug="api-pro",
    price_per_call=2.50,
)

payment = fixtures.payment(
    resource_id=resource["id"],
    payer_wallet="wallet_123",
    amount_usd=100.00,
    status="completed",
)

vendor = fixtures.vendor(
    name="Acme Corp",
    email="billing@acme.com",
)

# Pre-built scenarios
data = scenarios.vendor_with_resources()
print(data["active_resource"]["active"])  # True

data2 = scenarios.paid_and_entitled()
# Has: resource, payment, entitlement
```

### Context manager (no pytest)

```python
from mainlayer_testing import MainlayerMockServer

with MainlayerMockServer() as server:
    resource = server.add_resource(slug="direct-api")
    server.set_entitlement(resource["id"], "wallet_x", True)

    # Use server.url in requests
    import requests
    resp = requests.get(f"{server.url}/v1/health")
    print(resp.status_code)  # 200
```

---

## API reference

### Resource management

```typescript
// TypeScript
server.addResource({
  slug: 'unique-slug',          // Required
  name?: string,                // Default: slug
  description?: string,
  price_per_call?: number,      // Default: 1.00
  price_monthly_subscription?: number,
  active?: boolean,             // Default: true
}): Resource

server.getResources(): Resource[]
server.updateResource(id, updates): Resource
server.deleteResource(id): void
```

### Payment management

```typescript
server.getPayments(): Payment[]
server.createPayment({
  resource_id: string,
  payer_wallet: string,
  amount_usd: number,
}): Payment
```

### Entitlement management

```typescript
server.setEntitlement(
  resource_id: string,
  payer_wallet: string,
  entitled: boolean,
): void

server.getEntitlements(): Entitlement[]
server.revokeEntitlement(resource_id, payer_wallet): void
```

### Server management

```typescript
server.start(): Promise<void>      // Bind to port
server.stop(): Promise<void>       // Shutdown
server.reset(): void               // Clear state (keeps running)
server.url: string                 // e.g., http://127.0.0.1:12345
```

---

## Mock API endpoints

The mock implements all Mainlayer `/v1/` endpoints:

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/health` | No | Health check |
| `GET` | `/v1/health` | Yes | Health check |
| **Resources** |
| `GET` | `/v1/resources` | Yes | List resources |
| `POST` | `/v1/resources` | Yes | Create resource |
| `GET` | `/v1/resources/:id` | Yes | Get resource by ID or slug |
| `PATCH` | `/v1/resources/:id` | Yes | Update resource |
| `DELETE` | `/v1/resources/:id` | Yes | Delete resource |
| **Entitlements** |
| `GET` | `/v1/entitlements/check` | Yes | Check access (`?resource_id=...&payer_wallet=...`) |
| `GET` | `/v1/entitlements` | Yes | List entitlements |
| `POST` | `/v1/entitlements` | Yes | Grant entitlement |
| `DELETE` | `/v1/entitlements` | Yes | Revoke entitlement |
| **Payments** |
| `POST` | `/v1/payments` | Yes | Create payment (auto-grants entitlement) |
| `GET` | `/v1/payments` | Yes | List payments |
| `GET` | `/v1/payments/:id` | Yes | Get payment |
| **Users** |
| `GET` | `/v1/users/me` | Yes | Get current vendor |
| `GET` | `/v1/users/:id` | Yes | Get vendor |

**Auth header format:**
```
Authorization: Bearer <any-non-empty-string>
```

The mock accepts any token. Use `Bearer sk_test_anything` or your real key format.

---

## Complete example: SaaS payment gating

### Setup (shared)

```typescript
// test/fixtures.ts
import { MainlayerMockServer, fixtures, scenarios } from '@mainlayer/testing';

export async function setupTestServer() {
  const server = new MainlayerMockServer();
  await server.start();

  // Create a few resources
  const basicPlan = server.addResource({
    slug: 'basic-plan',
    name: 'Basic Plan',
    price_monthly_subscription: 10,
  });

  const proResource = server.addResource({
    slug: 'pro-api',
    name: 'Pro API',
    price_per_call: 0.05,
  });

  return { server, basicPlan, proResource };
}
```

### TypeScript test

```typescript
// test/payment.test.ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupTestServer } from './fixtures';

describe('Payment gating', () => {
  let server: any, basicPlan: any, proResource: any;

  beforeAll(async () => {
    ({ server, basicPlan, proResource } = await setupTestServer());
  });

  afterAll(async () => {
    await server.stop();
  });

  beforeEach(() => server.reset());

  it('denies access to unpaid users', async () => {
    const wallet = 'wallet_unpaid';

    const resp = await fetch(
      `${server.url}/v1/entitlements/check?resource_id=${proResource.id}&payer_wallet=${wallet}`,
      { headers: { Authorization: 'Bearer sk_test' } }
    );

    expect((await resp.json()).data.entitled).toBe(false);
  });

  it('grants access after payment', async () => {
    const wallet = 'wallet_paid';

    // Create payment
    const payResp = await fetch(`${server.url}/v1/payments`, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer sk_test',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        resource_id: proResource.id,
        payer_wallet: wallet,
        amount_usd: 50.00,
      }),
    });
    expect(payResp.status).toBe(201);

    // Check access
    const checkResp = await fetch(
      `${server.url}/v1/entitlements/check?resource_id=${proResource.id}&payer_wallet=${wallet}`,
      { headers: { Authorization: 'Bearer sk_test' } }
    );

    expect((await checkResp.json()).data.entitled).toBe(true);
  });
});
```

### Python test

```python
# test_payment.py
import pytest
import requests

@pytest.fixture
def setup(mainlayer_server):
    """Setup resources for payment tests."""
    basic_plan = mainlayer_server.add_resource(
        slug="basic-plan",
        price_monthly_subscription=10.00,
    )
    pro_resource = mainlayer_server.add_resource(
        slug="pro-api",
        price_per_call=0.05,
    )
    return {
        "server": mainlayer_server,
        "basic_plan": basic_plan,
        "pro_resource": pro_resource,
    }

def test_denies_unpaid(setup):
    """Unpaid users cannot access."""
    server = setup["server"]
    resource = setup["pro_resource"]
    wallet = "wallet_unpaid"

    resp = requests.get(
        f"{server.url}/v1/entitlements/check",
        params={
            "resource_id": resource["id"],
            "payer_wallet": wallet,
        },
        headers={"Authorization": "Bearer sk_test"},
    )
    assert resp.json()["data"]["entitled"] is False

def test_grants_after_payment(setup):
    """Paid users get access."""
    server = setup["server"]
    resource = setup["pro_resource"]
    wallet = "wallet_paid"

    # Create payment
    pay_resp = requests.post(
        f"{server.url}/v1/payments",
        json={
            "resource_id": resource["id"],
            "payer_wallet": wallet,
            "amount_usd": 50.00,
        },
        headers={
            "Authorization": "Bearer sk_test",
            "Content-Type": "application/json",
        },
    )
    assert pay_resp.status_code == 201

    # Check access
    check_resp = requests.get(
        f"{server.url}/v1/entitlements/check",
        params={
            "resource_id": resource["id"],
            "payer_wallet": wallet,
        },
        headers={"Authorization": "Bearer sk_test"},
    )
    assert check_resp.json()["data"]["entitled"] is True
```

---

## Running tests

**TypeScript:**
```bash
cd typescript
npm install
npm test
npm run test:watch
```

**Python:**
```bash
cd python
pip install -e ".[dev]"
pytest tests/ -v
pytest tests/ -v --tb=short
```

---

## License

MIT

---

**Need help?** See [docs.mainlayer.fr](https://docs.mainlayer.fr) or open an issue on [GitHub](https://github.com/mainlayer/mainlayer-testing/issues).
