# mainlayer-testing

Mock server and test helpers for [Mainlayer](https://mainlayer.fr) integrations — available as both a **TypeScript/Node.js** package and a **Python** package.

Mainlayer is payment infrastructure for AI agents. This package lets you write fast, deterministic integration tests against a local mock that mirrors the Mainlayer API (`https://api.mainlayer.fr`) without making real network calls or incurring charges.

---

## What's included

| Feature | TypeScript | Python |
|---|---|---|
| In-process mock HTTP server | `MainlayerMockServer` (Express) | `MainlayerMockServer` (Flask) |
| State management | `setEntitlement`, `addResource`, `getPayments`, `reset` | Same API |
| Test data factories | `fixtures.*`, `scenarios.*` | `fixtures.*`, `scenarios.*` |
| MSW interceptors (browser/Node) | `createHandlers` | — |
| pytest plugin + fixtures | — | `mainlayer_server`, `mainlayer_env` |

---

## TypeScript

### Installation

```bash
npm install --save-dev @mainlayer/testing
# or
yarn add --dev @mainlayer/testing
```

Peer dependency for MSW interceptors (optional):

```bash
npm install --save-dev msw
```

### Quick start (Vitest / Jest)

```typescript
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { MainlayerMockServer } from '@mainlayer/testing';

const server = new MainlayerMockServer();

beforeAll(() => server.start());
afterAll(() => server.stop());
beforeEach(() => server.reset());

it('grants access after payment', async () => {
  const resource = server.addResource({ slug: 'my-api', price_per_call: 1.00 });

  // Before payment — not entitled
  const res1 = await fetch(
    `${server.url}/v1/entitlements/check?resource_id=${resource.id}&payer_wallet=wallet_abc`,
    { headers: { Authorization: 'Bearer sk_test_key' } }
  );
  expect((await res1.json()).data.entitled).toBe(false);

  // Make a payment
  await fetch(`${server.url}/v1/payments`, {
    method: 'POST',
    headers: { Authorization: 'Bearer sk_test_key', 'Content-Type': 'application/json' },
    body: JSON.stringify({ resource_id: resource.id, payer_wallet: 'wallet_abc' }),
  });

  // After payment — entitled
  const res2 = await fetch(
    `${server.url}/v1/entitlements/check?resource_id=${resource.id}&payer_wallet=wallet_abc`,
    { headers: { Authorization: 'Bearer sk_test_key' } }
  );
  expect((await res2.json()).data.entitled).toBe(true);
});
```

### Seeding state directly

```typescript
// Seed an entitlement without going through the payment flow
server.setEntitlement(resource.id, 'wallet_subscriber', true);

// Inspect recorded payments
const payments = server.getPayments();
console.log(payments[0].amount); // 1.00
```

### Fixtures and scenarios

```typescript
import { fixtures, scenarios } from '@mainlayer/testing';

// Individual factories — all fields have sensible defaults
const resource = fixtures.resource({ price_per_call: 0.05 });
const payment = fixtures.payment({ resource_id: resource.id, status: 'completed' });
const vendor = fixtures.vendor({ name: 'Acme Corp' });

// Pre-built multi-entity scenarios
const { vendor: v, activeResource, inactiveResource } = scenarios.vendorWithResources();
const { resource: r, payment: p, entitlement: e } = scenarios.paidAndEntitled();
```

### MSW interceptors (browser / jsdom)

Use these when you need to mock Mainlayer in a browser environment (Storybook, Vitest browser mode) or when a full server isn't practical:

```typescript
import { setupServer } from 'msw/node';
import { createHandlers, createStore } from '@mainlayer/testing/interceptors';

// Optionally share a store to pre-seed or inspect state
const store = createStore();
const mswServer = setupServer(...createHandlers({ store }));

beforeAll(() => mswServer.listen());
afterEach(() => mswServer.resetHandlers());
afterAll(() => mswServer.close());

// Pre-seed a resource into the store
store.resources.set('res_test_000001', {
  id: 'res_test_000001',
  slug: 'gated-api',
  // ...
});
```

Custom base URL (e.g. staging):

```typescript
createHandlers({ baseUrl: 'https://api.mainlayer.fr' })
```

---

## Python

### Installation

```bash
pip install mainlayer-testing
# With pytest plugin support (auto-registered)
pip install "mainlayer-testing[pytest]"
# With requests for example tests
pip install "mainlayer-testing[pytest,requests]"
```

### Quick start (pytest)

The pytest plugin registers fixtures automatically once the package is installed. No `conftest.py` needed.

```python
# test_my_service.py
import requests
import pytest

def test_access_gated_behind_payment(mainlayer_server):
    resource = mainlayer_server.add_resource(slug="my-api", price_per_call=1.00)
    client_headers = {"Authorization": "Bearer sk_test_key"}

    # Check — not entitled
    resp = requests.get(
        f"{mainlayer_server.url}/v1/entitlements/check",
        params={"resource_id": resource["id"], "payer_wallet": "wallet_abc"},
        headers=client_headers,
    )
    assert resp.json()["data"]["entitled"] is False

    # Pay
    requests.post(
        f"{mainlayer_server.url}/v1/payments",
        json={"resource_id": resource["id"], "payer_wallet": "wallet_abc"},
        headers={**client_headers, "Content-Type": "application/json"},
    )

    # Now entitled
    resp2 = requests.get(
        f"{mainlayer_server.url}/v1/entitlements/check",
        params={"resource_id": resource["id"], "payer_wallet": "wallet_abc"},
        headers=client_headers,
    )
    assert resp2.json()["data"]["entitled"] is True
```

### Available pytest fixtures

| Fixture | Scope | Description |
|---|---|---|
| `mainlayer_server` | function | Mock server, reset before each test |
| `mainlayer_url` | function | `str` — base URL of the running server |
| `mainlayer_env` | function | Server + sets `MAINLAYER_BASE_URL` env var |
| `mainlayer_server_session` | session | Long-lived server, no auto-reset |

### Seeding state

```python
def test_with_seeded_entitlement(mainlayer_server):
    resource = mainlayer_server.add_resource(slug="premium-api")
    mainlayer_server.set_entitlement(resource["id"], "wallet_sub", True)
    # ... your assertions
```

### Context manager (no pytest)

```python
from mainlayer_testing import MainlayerMockServer

with MainlayerMockServer() as server:
    resource = server.add_resource(slug="direct-api")
    server.set_entitlement(resource["id"], "wallet_x", True)
    print(server.url)  # http://127.0.0.1:<port>
```

### Fixtures and scenarios

```python
from mainlayer_testing.fixtures import fixtures, scenarios

resource = fixtures.resource(price_per_call=0.05)
payment  = fixtures.payment(resource_id=resource["id"], status="completed")
vendor   = fixtures.vendor(name="Acme Corp")

# Pre-built multi-entity scenarios
data = scenarios.vendor_with_resources()
print(data["active_resource"]["active"])   # True
print(data["inactive_resource"]["active"]) # False

data2 = scenarios.paid_and_entitled()
# data2["resource"], data2["payment"], data2["entitlement"]
```

---

## Mock API reference

The mock server implements all core Mainlayer API endpoints under `/v1/`:

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Health check (no auth) |
| `GET` | `/v1/health` | Health check (auth required) |
| `GET` | `/v1/resources` | List all resources |
| `POST` | `/v1/resources` | Create a resource |
| `GET` | `/v1/resources/:id` | Get resource by ID or slug |
| `PATCH` | `/v1/resources/:id` | Update a resource |
| `DELETE` | `/v1/resources/:id` | Delete a resource |
| `GET` | `/v1/entitlements/check` | Check if payer is entitled |
| `GET` | `/v1/entitlements` | List entitlements |
| `POST` | `/v1/entitlements` | Grant an entitlement |
| `DELETE` | `/v1/entitlements` | Revoke an entitlement |
| `POST` | `/v1/payments` | Initiate a payment (auto-grants entitlement) |
| `GET` | `/v1/payments` | List payments |
| `GET` | `/v1/payments/:id` | Get a payment |
| `GET` | `/v1/users/me` | Get current vendor |
| `GET` | `/v1/users/:id` | Get vendor by ID |

Authentication: all `/v1/` routes require `Authorization: Bearer <token>` (any non-empty token is accepted by the mock).

---

## Running tests

**TypeScript:**

```bash
cd typescript
npm install
npm test
```

**Python:**

```bash
cd python
pip install -e ".[dev]"
pytest tests/ -v
```

---

## License

MIT
