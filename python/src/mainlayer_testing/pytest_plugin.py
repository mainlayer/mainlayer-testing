"""
pytest plugin for Mainlayer integration testing.

Registers fixtures and marks so your tests can use the mock server
with minimal boilerplate.

Auto-registration (via ``entry_points`` in pyproject.toml):
    The plugin is automatically loaded by pytest when the package is installed.
    No ``conftest.py`` is required.

Marks::

    @pytest.mark.mainlayer
    # Marks a test as a Mainlayer integration test (for filtering with -m).

Fixtures::

    mainlayer_server  — A running MainlayerMockServer, reset between each test.
    mainlayer_url     — The base URL of the running mock server (str).

Usage::

    def test_payment_flow(mainlayer_server):
        resource = mainlayer_server.add_resource(slug="my-api", price_per_call=0.10)
        mainlayer_server.set_entitlement(resource["id"], "wallet_xyz", True)

        import requests
        resp = requests.get(
            f"{mainlayer_server.url}/v1/entitlements/check",
            params={"resource_id": resource["id"], "payer_wallet": "wallet_xyz"},
            headers={"Authorization": "Bearer sk_test_key"},
        )
        assert resp.json()["data"]["entitled"] is True
"""

from __future__ import annotations

import os
from typing import Generator

import pytest

from .mock_server import MainlayerMockServer


# ---------------------------------------------------------------------------
# Marks
# ---------------------------------------------------------------------------

def pytest_configure(config: pytest.Config) -> None:
    """Register the ``mainlayer`` mark so pytest doesn't warn about unknown marks."""
    config.addinivalue_line(
        "markers",
        "mainlayer: mark a test as a Mainlayer integration test",
    )


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(scope="session")
def mainlayer_server_session() -> Generator[MainlayerMockServer, None, None]:
    """
    A session-scoped mock server. Shared across all tests in a session.

    The server is NOT reset between tests — you must call ``server.reset()`` manually
    or use the function-scoped ``mainlayer_server`` fixture instead.
    """
    server = MainlayerMockServer()
    server.start()
    yield server
    server.stop()


@pytest.fixture
def mainlayer_server(mainlayer_server_session: MainlayerMockServer) -> Generator[MainlayerMockServer, None, None]:
    """
    A function-scoped mock server fixture.

    The server is reset before each test to ensure isolation.
    The underlying HTTP server is started once per session for performance.
    """
    mainlayer_server_session.reset()
    yield mainlayer_server_session


@pytest.fixture
def mainlayer_url(mainlayer_server: MainlayerMockServer) -> str:
    """
    The base URL of the running mock server.

    Convenience fixture when you only need the URL (e.g., to configure an SDK client).
    """
    return mainlayer_server.url


@pytest.fixture
def mainlayer_env(mainlayer_server: MainlayerMockServer, monkeypatch: pytest.MonkeyPatch) -> MainlayerMockServer:
    """
    Sets ``MAINLAYER_BASE_URL`` environment variable to the mock server URL,
    and yields the server so tests can seed state.

    Useful when your code reads ``MAINLAYER_BASE_URL`` from the environment.
    """
    monkeypatch.setenv("MAINLAYER_BASE_URL", mainlayer_server.url)
    return mainlayer_server
