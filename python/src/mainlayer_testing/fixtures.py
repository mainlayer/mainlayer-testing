"""
Test data factories for Mainlayer integration testing.

Provides deterministic, realistic test data via simple factory functions.
All factories accept keyword-argument overrides — only specify the fields you care about.

Usage::

    from mainlayer_testing import fixtures

    resource = fixtures.resource(price_per_call=0.05)
    payment = fixtures.payment(resource_id=resource["id"])
    entitlement = fixtures.entitlement(active=True)
"""

from __future__ import annotations

import random
import string
from datetime import datetime, timezone
from typing import Any


# ---------------------------------------------------------------------------
# Internal counter for deterministic IDs
# ---------------------------------------------------------------------------

_id_counter = 0


def _next_id(prefix: str) -> str:
    global _id_counter
    _id_counter += 1
    return f"{prefix}_test_{str(_id_counter).zfill(6)}"


def reset_id_counter() -> None:
    """Reset the global ID counter. Call between test suites for reproducibility."""
    global _id_counter
    _id_counter = 0


def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _random_api_key() -> str:
    chars = string.ascii_lowercase + string.digits
    return "sk_test_" + "".join(random.choices(chars, k=16))


# ---------------------------------------------------------------------------
# Individual factories
# ---------------------------------------------------------------------------

class _Fixtures:
    """
    Namespace of factory functions for Mainlayer test data.

    All methods return plain dicts matching the Mainlayer API response schema.
    """

    def resource(self, overrides: dict[str, Any] | None = None) -> dict[str, Any]:
        """
        Create a Resource fixture.

        Args:
            overrides: Fields to override. Unspecified fields get sensible defaults.

        Returns:
            A dict matching the Mainlayer resource schema.
        """
        overrides = overrides or {}
        return {
            "id": overrides.get("id", _next_id("res")),
            "slug": overrides.get("slug", "test-resource"),
            "name": overrides.get("name", "Test Resource"),
            "description": overrides.get("description", "A test resource for integration testing"),
            "price_per_call": overrides.get("price_per_call", 1.00),
            "vendor_id": overrides.get("vendor_id", _next_id("usr")),
            "active": overrides.get("active", True),
            "created_at": overrides.get("created_at", _iso_now()),
            "updated_at": overrides.get("updated_at", _iso_now()),
            "metadata": overrides.get("metadata", {}),
        }

    def payment(self, overrides: dict[str, Any] | None = None) -> dict[str, Any]:
        """
        Create a Payment fixture.

        Args:
            overrides: Fields to override.

        Returns:
            A dict matching the Mainlayer payment schema.
        """
        overrides = overrides or {}
        return {
            "id": overrides.get("id", _next_id("pay")),
            "resource_id": overrides.get("resource_id", _next_id("res")),
            "payer_wallet": overrides.get("payer_wallet", "wallet_test_payer_001"),
            "vendor_id": overrides.get("vendor_id", _next_id("usr")),
            "amount": overrides.get("amount", 1.00),
            "currency": overrides.get("currency", "USD"),
            "status": overrides.get("status", "completed"),
            "created_at": overrides.get("created_at", _iso_now()),
            "metadata": overrides.get("metadata", {}),
        }

    def entitlement(self, overrides: dict[str, Any] | None = None) -> dict[str, Any]:
        """
        Create an Entitlement fixture.

        Args:
            overrides: Fields to override.

        Returns:
            A dict matching the Mainlayer entitlement schema.
        """
        overrides = overrides or {}
        return {
            "resource_id": overrides.get("resource_id", _next_id("res")),
            "payer_wallet": overrides.get("payer_wallet", "wallet_test_payer_001"),
            "active": overrides.get("active", True),
            "granted_at": overrides.get("granted_at", _iso_now()),
            "expires_at": overrides.get("expires_at", None),
        }

    def vendor(self, overrides: dict[str, Any] | None = None) -> dict[str, Any]:
        """
        Create a Vendor fixture.

        Args:
            overrides: Fields to override.

        Returns:
            A dict matching the Mainlayer vendor/user schema.
        """
        overrides = overrides or {}
        return {
            "id": overrides.get("id", _next_id("usr")),
            "name": overrides.get("name", "Test Vendor"),
            "email": overrides.get("email", "vendor@example.com"),
            "api_key": overrides.get("api_key", _random_api_key()),
            "created_at": overrides.get("created_at", _iso_now()),
            "metadata": overrides.get("metadata", {}),
        }

    def payment_request(self, overrides: dict[str, Any] | None = None) -> dict[str, Any]:
        """
        Create a PaymentRequest fixture suitable for POST /v1/payments.

        Args:
            overrides: Fields to override.

        Returns:
            A dict with resource_id, payer_wallet, and optional amount/metadata.
        """
        overrides = overrides or {}
        return {
            "resource_id": overrides.get("resource_id", _next_id("res")),
            "payer_wallet": overrides.get("payer_wallet", "wallet_test_payer_001"),
            **({"amount": overrides["amount"]} if "amount" in overrides else {}),
            "metadata": overrides.get("metadata", {}),
        }


#: Singleton instance — import and use directly.
fixtures = _Fixtures()


# ---------------------------------------------------------------------------
# Scenario helpers
# ---------------------------------------------------------------------------

class _Scenarios:
    """Convenience collections of pre-built fixtures for common test scenarios."""

    def vendor_with_resources(self) -> dict[str, Any]:
        """A vendor with two resources — one active, one inactive."""
        vendor = fixtures.vendor()
        active_resource = fixtures.resource({"vendor_id": vendor["id"], "active": True})
        inactive_resource = fixtures.resource({
            "vendor_id": vendor["id"],
            "active": False,
            "slug": "inactive-resource",
        })
        return {
            "vendor": vendor,
            "active_resource": active_resource,
            "inactive_resource": inactive_resource,
        }

    def paid_and_entitled(self) -> dict[str, Any]:
        """A resource with a completed payment and granted entitlement."""
        resource = fixtures.resource()
        payment = fixtures.payment({
            "resource_id": resource["id"],
            "vendor_id": resource["vendor_id"],
            "status": "completed",
        })
        entitlement = fixtures.entitlement({
            "resource_id": resource["id"],
            "payer_wallet": payment["payer_wallet"],
            "active": True,
        })
        return {"resource": resource, "payment": payment, "entitlement": entitlement}

    def failed_payment(self) -> dict[str, Any]:
        """A failed payment scenario — entitlement should not be granted."""
        resource = fixtures.resource()
        payment = fixtures.payment({
            "resource_id": resource["id"],
            "vendor_id": resource["vendor_id"],
            "status": "failed",
        })
        return {"resource": resource, "payment": payment}


#: Singleton instance — import and use directly.
scenarios = _Scenarios()
