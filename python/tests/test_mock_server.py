"""
Tests for MainlayerMockServer (Python).

Covers all major API surfaces: resources, entitlements, payments, auth, and edge cases.
Run with: pytest python/tests/ -v
"""

from __future__ import annotations

import pytest
import requests

from mainlayer_testing import MainlayerMockServer
from mainlayer_testing.fixtures import fixtures, scenarios, reset_id_counter


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

API_KEY = "sk_test_integration_key"
AUTH = {"Authorization": f"Bearer {API_KEY}"}
JSON_HEADERS = {**AUTH, "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def server():
    """One mock server for all tests in this module."""
    with MainlayerMockServer(require_auth=True) as s:
        yield s


@pytest.fixture(autouse=True)
def reset_state(server: MainlayerMockServer):
    """Reset server state and ID counter before each test."""
    server.reset()
    reset_id_counter()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def get(server: MainlayerMockServer, path: str, **kwargs):
    return requests.get(f"{server.url}{path}", headers=AUTH, **kwargs)


def post(server: MainlayerMockServer, path: str, body: dict, **kwargs):
    return requests.post(f"{server.url}{path}", json=body, headers=JSON_HEADERS, **kwargs)


def patch(server: MainlayerMockServer, path: str, body: dict, **kwargs):
    return requests.patch(f"{server.url}{path}", json=body, headers=JSON_HEADERS, **kwargs)


def delete(server: MainlayerMockServer, path: str, **kwargs):
    return requests.delete(f"{server.url}{path}", headers=AUTH, **kwargs)


# ---------------------------------------------------------------------------
# Server lifecycle
# ---------------------------------------------------------------------------

class TestServerLifecycle:
    def test_url_is_set_after_start(self, server: MainlayerMockServer):
        assert server.url.startswith("http://127.0.0.1:")

    def test_root_health_requires_no_auth(self, server: MainlayerMockServer):
        resp = requests.get(f"{server.url}/health")
        assert resp.status_code == 200
        assert resp.json()["status"] == "ok"

    def test_v1_health_requires_auth(self, server: MainlayerMockServer):
        resp = get(server, "/v1/health")
        assert resp.status_code == 200
        assert resp.json()["status"] == "ok"

    def test_context_manager_starts_and_stops(self):
        with MainlayerMockServer() as s:
            resp = requests.get(f"{s.url}/health")
            assert resp.status_code == 200
        # After exiting the context, the server should be stopped
        with pytest.raises(Exception):
            requests.get(f"{s.url}/health", timeout=0.5)


# ---------------------------------------------------------------------------
# Authentication
# ---------------------------------------------------------------------------

class TestAuthentication:
    def test_rejects_request_without_auth(self, server: MainlayerMockServer):
        resp = requests.get(f"{server.url}/v1/resources")
        assert resp.status_code == 401

    def test_rejects_empty_bearer_token(self, server: MainlayerMockServer):
        resp = requests.get(
            f"{server.url}/v1/resources",
            headers={"Authorization": "Bearer "},
        )
        assert resp.status_code == 401

    def test_accepts_valid_bearer_token(self, server: MainlayerMockServer):
        resp = get(server, "/v1/resources")
        assert resp.status_code == 200

    def test_no_auth_required_when_disabled(self):
        with MainlayerMockServer(require_auth=False) as s:
            resp = requests.get(f"{s.url}/v1/resources")
            assert resp.status_code == 200


# ---------------------------------------------------------------------------
# Resources
# ---------------------------------------------------------------------------

class TestResources:
    def test_list_empty_by_default(self, server: MainlayerMockServer):
        resp = get(server, "/v1/resources")
        assert resp.status_code == 200
        body = resp.json()
        assert body["data"] == []
        assert body["total"] == 0

    def test_list_seeded_resources(self, server: MainlayerMockServer):
        server.add_resource(slug="alpha", name="Alpha")
        server.add_resource(slug="beta", name="Beta")
        resp = get(server, "/v1/resources")
        assert resp.json()["total"] == 2

    def test_get_resource_by_id(self, server: MainlayerMockServer):
        resource = server.add_resource(slug="by-id")
        resp = get(server, f"/v1/resources/{resource['id']}")
        assert resp.status_code == 200
        assert resp.json()["data"]["id"] == resource["id"]

    def test_get_resource_by_slug(self, server: MainlayerMockServer):
        server.add_resource(slug="by-slug")
        resp = get(server, "/v1/resources/by-slug")
        assert resp.status_code == 200
        assert resp.json()["data"]["slug"] == "by-slug"

    def test_get_unknown_resource_returns_404(self, server: MainlayerMockServer):
        resp = get(server, "/v1/resources/res_ghost")
        assert resp.status_code == 404

    def test_create_resource_via_post(self, server: MainlayerMockServer):
        resp = post(server, "/v1/resources", {"slug": "new-res", "name": "New Resource"})
        assert resp.status_code == 201
        assert resp.json()["data"]["slug"] == "new-res"

    def test_create_resource_without_slug_returns_400(self, server: MainlayerMockServer):
        resp = post(server, "/v1/resources", {"name": "No Slug"})
        assert resp.status_code == 400

    def test_create_duplicate_slug_returns_409(self, server: MainlayerMockServer):
        server.add_resource(slug="dupe")
        resp = post(server, "/v1/resources", {"slug": "dupe"})
        assert resp.status_code == 409

    def test_patch_resource(self, server: MainlayerMockServer):
        resource = server.add_resource(slug="patchable", name="Before")
        resp = patch(server, f"/v1/resources/{resource['id']}", {"name": "After"})
        assert resp.status_code == 200
        body = resp.json()["data"]
        assert body["name"] == "After"
        assert body["id"] == resource["id"]  # id is immutable

    def test_patch_unknown_resource_returns_404(self, server: MainlayerMockServer):
        resp = patch(server, "/v1/resources/res_missing", {"name": "X"})
        assert resp.status_code == 404

    def test_delete_resource(self, server: MainlayerMockServer):
        resource = server.add_resource(slug="deletable")
        resp = delete(server, f"/v1/resources/{resource['id']}")
        assert resp.status_code == 204
        check = get(server, f"/v1/resources/{resource['id']}")
        assert check.status_code == 404


# ---------------------------------------------------------------------------
# Entitlements
# ---------------------------------------------------------------------------

class TestEntitlements:
    def test_check_returns_false_when_no_entitlement(self, server: MainlayerMockServer):
        resp = get(server, "/v1/entitlements/check?resource_id=res_x&payer_wallet=wallet_y")
        assert resp.status_code == 200
        assert resp.json()["data"]["entitled"] is False

    def test_check_returns_true_after_set(self, server: MainlayerMockServer):
        server.set_entitlement("res_abc", "wallet_abc", True)
        resp = get(server, "/v1/entitlements/check?resource_id=res_abc&payer_wallet=wallet_abc")
        assert resp.json()["data"]["entitled"] is True

    def test_check_returns_false_when_inactive(self, server: MainlayerMockServer):
        server.set_entitlement("res_abc", "wallet_abc", False)
        resp = get(server, "/v1/entitlements/check?resource_id=res_abc&payer_wallet=wallet_abc")
        assert resp.json()["data"]["entitled"] is False

    def test_check_missing_params_returns_400(self, server: MainlayerMockServer):
        resp = get(server, "/v1/entitlements/check?payer_wallet=wallet_x")
        assert resp.status_code == 400

    def test_grant_entitlement_via_post(self, server: MainlayerMockServer):
        resp = post(server, "/v1/entitlements", {"resource_id": "res_g", "payer_wallet": "wallet_g"})
        assert resp.status_code == 201
        assert resp.json()["data"]["active"] is True

    def test_revoke_entitlement_via_delete(self, server: MainlayerMockServer):
        server.set_entitlement("res_r", "wallet_r", True)
        resp = delete(server, "/v1/entitlements?resource_id=res_r&payer_wallet=wallet_r")
        assert resp.status_code == 200
        assert resp.json()["data"]["active"] is False

    def test_revoke_nonexistent_entitlement_returns_404(self, server: MainlayerMockServer):
        resp = delete(server, "/v1/entitlements?resource_id=res_none&payer_wallet=wallet_none")
        assert resp.status_code == 404

    def test_list_entitlements_filtered_by_wallet(self, server: MainlayerMockServer):
        server.set_entitlement("res_a", "wallet_1", True)
        server.set_entitlement("res_b", "wallet_1", True)
        server.set_entitlement("res_c", "wallet_2", True)
        resp = get(server, "/v1/entitlements?payer_wallet=wallet_1")
        assert resp.json()["total"] == 2


# ---------------------------------------------------------------------------
# Payments
# ---------------------------------------------------------------------------

class TestPayments:
    def test_create_payment_grants_entitlement(self, server: MainlayerMockServer):
        resource = server.add_resource(slug="pay-resource", price_per_call=2.50)
        resp = post(server, "/v1/payments", {"resource_id": resource["id"], "payer_wallet": "wallet_buyer"})
        assert resp.status_code == 201
        data = resp.json()["data"]
        assert data["status"] == "completed"
        assert data["amount"] == 2.50

        check = get(
            server,
            f"/v1/entitlements/check?resource_id={resource['id']}&payer_wallet=wallet_buyer",
        )
        assert check.json()["data"]["entitled"] is True

    def test_create_payment_recorded_in_get_payments(self, server: MainlayerMockServer):
        resource = server.add_resource(slug="trackable")
        post(server, "/v1/payments", {"resource_id": resource["id"], "payer_wallet": "wallet_track"})
        payments = server.get_payments()
        assert len(payments) == 1
        assert payments[0]["resource_id"] == resource["id"]

    def test_create_payment_missing_payer_wallet_returns_400(self, server: MainlayerMockServer):
        resource = server.add_resource(slug="no-wallet")
        resp = post(server, "/v1/payments", {"resource_id": resource["id"]})
        assert resp.status_code == 400

    def test_create_payment_unknown_resource_returns_404(self, server: MainlayerMockServer):
        resp = post(server, "/v1/payments", {"resource_id": "res_ghost", "payer_wallet": "wallet_x"})
        assert resp.status_code == 404

    def test_get_payment_by_id(self, server: MainlayerMockServer):
        resource = server.add_resource(slug="fetchable")
        create_resp = post(server, "/v1/payments", {"resource_id": resource["id"], "payer_wallet": "wallet_s"})
        pay_id = create_resp.json()["data"]["id"]

        resp = get(server, f"/v1/payments/{pay_id}")
        assert resp.status_code == 200
        assert resp.json()["data"]["id"] == pay_id

    def test_list_payments_filtered_by_resource(self, server: MainlayerMockServer):
        r1 = server.add_resource(slug="resource-one")
        r2 = server.add_resource(slug="resource-two")
        post(server, "/v1/payments", {"resource_id": r1["id"], "payer_wallet": "w1"})
        post(server, "/v1/payments", {"resource_id": r2["id"], "payer_wallet": "w2"})

        resp = get(server, f"/v1/payments?resource_id={r1['id']}")
        assert resp.json()["total"] == 1


# ---------------------------------------------------------------------------
# State reset
# ---------------------------------------------------------------------------

class TestStateReset:
    def test_reset_clears_all_state(self, server: MainlayerMockServer):
        server.add_resource(slug="temp")
        server.set_entitlement("res_t", "wallet_t", True)
        server.reset()

        resp = get(server, "/v1/resources")
        assert resp.json()["data"] == []
        assert server.get_payments() == []
        assert server.get_entitlements() == []


# ---------------------------------------------------------------------------
# Scenarios
# ---------------------------------------------------------------------------

class TestScenarios:
    def test_vendor_with_resources(self):
        result = scenarios.vendor_with_resources()
        assert result["active_resource"]["vendor_id"] == result["vendor"]["id"]
        assert result["inactive_resource"]["vendor_id"] == result["vendor"]["id"]
        assert result["active_resource"]["active"] is True
        assert result["inactive_resource"]["active"] is False

    def test_paid_and_entitled(self):
        result = scenarios.paid_and_entitled()
        assert result["payment"]["resource_id"] == result["resource"]["id"]
        assert result["entitlement"]["resource_id"] == result["resource"]["id"]

    def test_failed_payment(self):
        result = scenarios.failed_payment()
        assert result["payment"]["status"] == "failed"
