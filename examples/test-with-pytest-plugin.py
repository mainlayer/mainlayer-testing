"""
Example: Testing a Mainlayer-integrated service using the pytest plugin.

Shows the recommended patterns for:
  - Using the ``mainlayer_server`` fixture for isolated per-test state
  - Using the ``mainlayer_env`` fixture to configure the environment variable
  - Seeding resources, entitlements, and asserting payment flows
  - Using scenario helpers for complex multi-entity setup

Run with:
    pip install mainlayer-testing[pytest,requests]
    pytest examples/test-with-pytest-plugin.py -v
"""

from __future__ import annotations

import os
import requests
import pytest

from mainlayer_testing import MainlayerMockServer
from mainlayer_testing.fixtures import fixtures, scenarios


# ---------------------------------------------------------------------------
# The "system under test" — a thin Mainlayer client.
# In a real project this would be your SDK or service class.
# ---------------------------------------------------------------------------

class MainlayerClient:
    """Thin HTTP client wrapping the Mainlayer payment API."""

    def __init__(self, base_url: str, api_key: str) -> None:
        self._base_url = base_url.rstrip("/")
        self._headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }

    def check_entitlement(self, resource_id: str, payer_wallet: str) -> bool:
        resp = requests.get(
            f"{self._base_url}/v1/entitlements/check",
            params={"resource_id": resource_id, "payer_wallet": payer_wallet},
            headers=self._headers,
        )
        resp.raise_for_status()
        return resp.json()["data"]["entitled"]

    def initiate_payment(self, resource_id: str, payer_wallet: str, amount: float | None = None) -> dict:
        payload: dict = {"resource_id": resource_id, "payer_wallet": payer_wallet}
        if amount is not None:
            payload["amount"] = amount
        resp = requests.post(f"{self._base_url}/v1/payments", json=payload, headers=self._headers)
        resp.raise_for_status()
        return resp.json()["data"]

    def get_resource(self, resource_id: str) -> dict:
        resp = requests.get(f"{self._base_url}/v1/resources/{resource_id}", headers=self._headers)
        resp.raise_for_status()
        return resp.json()["data"]


# ---------------------------------------------------------------------------
# Tests using mainlayer_server fixture (auto-reset between each test)
# ---------------------------------------------------------------------------

@pytest.mark.mainlayer
class TestAccessGating:
    """Demonstrate access gating via Mainlayer entitlements."""

    def test_denies_access_without_entitlement(self, mainlayer_server: MainlayerMockServer):
        resource = mainlayer_server.add_resource(slug="gated-api")
        client = MainlayerClient(mainlayer_server.url, "sk_test_key")

        assert client.check_entitlement(resource["id"], "wallet_new_user") is False

    def test_grants_access_after_seeding_entitlement(self, mainlayer_server: MainlayerMockServer):
        resource = mainlayer_server.add_resource(slug="gated-api")
        mainlayer_server.set_entitlement(resource["id"], "wallet_subscriber", True)
        client = MainlayerClient(mainlayer_server.url, "sk_test_key")

        assert client.check_entitlement(resource["id"], "wallet_subscriber") is True

    def test_grants_access_after_payment(self, mainlayer_server: MainlayerMockServer):
        resource = mainlayer_server.add_resource(slug="pay-per-call", price_per_call=0.10)
        client = MainlayerClient(mainlayer_server.url, "sk_test_key")

        # Not entitled before payment
        assert client.check_entitlement(resource["id"], "wallet_buyer") is False

        # Make a payment
        payment = client.initiate_payment(resource["id"], "wallet_buyer")
        assert payment["status"] == "completed"

        # Now entitled
        assert client.check_entitlement(resource["id"], "wallet_buyer") is True

    def test_payment_amount_uses_resource_price(self, mainlayer_server: MainlayerMockServer):
        resource = mainlayer_server.add_resource(slug="priced-api", price_per_call=3.75)
        client = MainlayerClient(mainlayer_server.url, "sk_test_key")

        client.initiate_payment(resource["id"], "wallet_payer")

        payments = mainlayer_server.get_payments()
        assert len(payments) == 1
        assert payments[0]["amount"] == 3.75

    def test_payment_amount_can_be_overridden(self, mainlayer_server: MainlayerMockServer):
        resource = mainlayer_server.add_resource(slug="custom-amount-api", price_per_call=5.00)
        client = MainlayerClient(mainlayer_server.url, "sk_test_key")

        client.initiate_payment(resource["id"], "wallet_custom", amount=1.00)

        payments = mainlayer_server.get_payments()
        assert payments[0]["amount"] == 1.00

    def test_resource_details_are_correct(self, mainlayer_server: MainlayerMockServer):
        seeded = mainlayer_server.add_resource(slug="data-api", name="Data API", price_per_call=2.50)
        client = MainlayerClient(mainlayer_server.url, "sk_test_key")

        fetched = client.get_resource(seeded["id"])
        assert fetched["slug"] == "data-api"
        assert fetched["price_per_call"] == 2.50


# ---------------------------------------------------------------------------
# Tests using mainlayer_env fixture (sets MAINLAYER_BASE_URL in env)
# ---------------------------------------------------------------------------

@pytest.mark.mainlayer
class TestEnvironmentConfiguration:
    """Show how mainlayer_env sets the environment variable for code that reads it."""

    def test_base_url_env_var_is_set(self, mainlayer_env: MainlayerMockServer):
        url = os.environ.get("MAINLAYER_BASE_URL")
        assert url is not None
        assert url == mainlayer_env.url
        assert url.startswith("http://127.0.0.1:")

    def test_client_built_from_env(self, mainlayer_env: MainlayerMockServer):
        base_url = os.environ["MAINLAYER_BASE_URL"]
        resource = mainlayer_env.add_resource(slug="env-api")
        mainlayer_env.set_entitlement(resource["id"], "wallet_env", True)

        client = MainlayerClient(base_url, "sk_test_key")
        assert client.check_entitlement(resource["id"], "wallet_env") is True


# ---------------------------------------------------------------------------
# Tests using scenario helpers
# ---------------------------------------------------------------------------

@pytest.mark.mainlayer
class TestScenarioHelpers:
    """Demonstrate use of pre-built scenario fixtures."""

    def test_vendor_with_resources_scenario(self, mainlayer_server: MainlayerMockServer):
        data = scenarios.vendor_with_resources()
        mainlayer_server.add_resource(**data["active_resource"])
        mainlayer_server.add_resource(**data["inactive_resource"])

        client = MainlayerClient(mainlayer_server.url, "sk_test_key")

        active = client.get_resource(data["active_resource"]["id"])
        assert active["active"] is True

        inactive = client.get_resource(data["inactive_resource"]["id"])
        assert inactive["active"] is False

    def test_paid_and_entitled_scenario(self, mainlayer_server: MainlayerMockServer):
        data = scenarios.paid_and_entitled()
        mainlayer_server.add_resource(**data["resource"])
        mainlayer_server.set_entitlement(
            data["resource"]["id"],
            data["entitlement"]["payer_wallet"],
            True,
        )

        client = MainlayerClient(mainlayer_server.url, "sk_test_key")
        assert client.check_entitlement(
            data["resource"]["id"],
            data["entitlement"]["payer_wallet"],
        ) is True

    def test_failed_payment_scenario_does_not_grant_access(self, mainlayer_server: MainlayerMockServer):
        """
        The failed_payment scenario returns a payment with status='failed'.
        The server does NOT auto-grant entitlements for failed payments —
        only successfully processed payments (POST /v1/payments) do.
        """
        data = scenarios.failed_payment()
        mainlayer_server.add_resource(**data["resource"])
        # No entitlement is seeded — the failed payment fixture is local state only

        client = MainlayerClient(mainlayer_server.url, "sk_test_key")
        entitled = client.check_entitlement(
            data["resource"]["id"],
            data["payment"]["payer_wallet"],
        )
        assert entitled is False


# ---------------------------------------------------------------------------
# Direct use (no plugin) — for reference
# ---------------------------------------------------------------------------

class TestDirectUse:
    """Show how to use MainlayerMockServer without the pytest plugin."""

    def test_context_manager_usage(self):
        with MainlayerMockServer() as server:
            resource = server.add_resource(slug="direct-api")
            server.set_entitlement(resource["id"], "wallet_direct", True)

            client = MainlayerClient(server.url, "sk_test_direct")
            assert client.check_entitlement(resource["id"], "wallet_direct") is True

    def test_fixtures_produce_unique_ids(self):
        r1 = fixtures.resource()
        r2 = fixtures.resource()
        assert r1["id"] != r2["id"]

    def test_vendor_fixture_has_api_key(self):
        vendor = fixtures.vendor()
        assert vendor["api_key"].startswith("sk_test_")
