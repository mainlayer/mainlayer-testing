"""
Flask-based mock server that mimics the Mainlayer API (https://api.mainlayer.fr).

Designed to start on a random available port and run in a background thread so
tests can interact with it via real HTTP requests. Supports both direct use and
use as a Python context manager.

Usage::

    server = MainlayerMockServer()
    server.start()
    # configure your client
    import os
    os.environ["MAINLAYER_BASE_URL"] = server.url
    # ... run tests ...
    server.stop()

Or with context manager::

    with MainlayerMockServer() as server:
        # server.url is available here
        ...
"""

from __future__ import annotations

import threading
import uuid
from datetime import datetime, timezone
from typing import Any

from flask import Flask, jsonify, request
from werkzeug.serving import make_server

from .fixtures import fixtures as _fixtures


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _entitlement_key(resource_id: str, payer_wallet: str) -> str:
    return f"{resource_id}::{payer_wallet}"


def _error_response(app: Flask, error: str, message: str, status_code: int):
    return jsonify({"error": error, "message": message, "status_code": status_code}), status_code


# ---------------------------------------------------------------------------
# MainlayerMockServer
# ---------------------------------------------------------------------------

class MainlayerMockServer:
    """
    In-process mock server for the Mainlayer payment API.

    Starts an actual HTTP server on localhost so your code uses a real HTTP
    client against realistic endpoints. State is fully controllable from tests.

    Args:
        port: TCP port to listen on. Defaults to 0 (OS picks a free port).
        require_auth: When True (default), enforces ``Authorization: Bearer <token>``
                      on all ``/v1/`` routes.
    """

    def __init__(self, port: int = 0, require_auth: bool = True) -> None:
        self._port = port
        self._require_auth = require_auth
        self._server: Any = None  # werkzeug BaseServer
        self._thread: threading.Thread | None = None
        self._app = self._build_app()
        self._state: dict[str, Any] = self._empty_state()

    # -------------------------------------------------------------------------
    # Lifecycle
    # -------------------------------------------------------------------------

    def start(self) -> None:
        """Start the mock server in a background thread."""
        self._server = make_server("127.0.0.1", self._port, self._app)
        self._port = self._server.server_port  # capture OS-assigned port
        self._thread = threading.Thread(target=self._server.serve_forever, daemon=True)
        self._thread.start()

    def stop(self) -> None:
        """Shut down the server and wait for the thread to exit."""
        if self._server is not None:
            self._server.shutdown()
            self._server = None
        if self._thread is not None:
            self._thread.join(timeout=5)
            self._thread = None

    def __enter__(self) -> "MainlayerMockServer":
        self.start()
        return self

    def __exit__(self, *_: Any) -> None:
        self.stop()

    @property
    def url(self) -> str:
        """Base URL of the running server, e.g. ``http://127.0.0.1:PORT``."""
        if self._server is None:
            raise RuntimeError("Server is not running. Call start() first.")
        return f"http://127.0.0.1:{self._port}"

    # -------------------------------------------------------------------------
    # State management
    # -------------------------------------------------------------------------

    def set_entitlement(self, resource_id: str, payer_wallet: str, active: bool) -> None:
        """Seed or update an entitlement for a (resource, payer) pair."""
        key = _entitlement_key(resource_id, payer_wallet)
        existing = self._state["entitlements"].get(key, {})
        self._state["entitlements"][key] = {
            "resource_id": resource_id,
            "payer_wallet": payer_wallet,
            "active": active,
            "granted_at": existing.get("granted_at", _iso_now()),
            "expires_at": existing.get("expires_at"),
        }

    def add_resource(self, **kwargs: Any) -> dict:
        """
        Add a resource to the mock catalogue.

        Keyword arguments are passed as overrides to the fixture factory.
        Returns the fully-populated resource dict.
        """
        resource = _fixtures.resource(kwargs)
        self._state["resources"][resource["id"]] = resource
        return resource

    def add_vendor(self, **kwargs: Any) -> dict:
        """Add a vendor to the user store. Returns the populated vendor dict."""
        vendor = _fixtures.vendor(kwargs)
        self._state["vendors"][vendor["id"]] = vendor
        return vendor

    def get_payments(self) -> list[dict]:
        """Return a copy of all payments recorded by the server."""
        return list(self._state["payments"])

    def get_entitlements(self) -> list[dict]:
        """Return a copy of all entitlements in the server."""
        return list(self._state["entitlements"].values())

    def reset(self) -> None:
        """Reset all server state. Call in test teardown for isolation."""
        self._state = self._empty_state()

    # -------------------------------------------------------------------------
    # Internal — Flask app
    # -------------------------------------------------------------------------

    @staticmethod
    def _empty_state() -> dict[str, Any]:
        return {
            "resources": {},
            "payments": [],
            "entitlements": {},
            "vendors": {},
        }

    def _check_auth(self):
        """Return an error tuple if auth fails, else None."""
        if not self._require_auth:
            return None
        auth = request.headers.get("Authorization", "")
        if not auth.startswith("Bearer ") or auth[7:].strip() == "":
            return (
                jsonify({"error": "unauthorized", "message": "Invalid or missing API key", "status_code": 401}),
                401,
            )
        return None

    def _build_app(self) -> Flask:
        app = Flask(__name__)
        app.config["TESTING"] = True

        state = self._state  # captured reference — updated on reset()

        # The decorators below close over `self` to access `self._state`.
        # Using a property reference means reset() works correctly.

        # -----------------------------------------------------------------
        # Health
        # -----------------------------------------------------------------

        @app.route("/health")
        def health():  # type: ignore[return]
            return jsonify({"status": "ok", "timestamp": _iso_now()})

        @app.route("/v1/health")
        def v1_health():  # type: ignore[return]
            auth_err = self._check_auth()
            if auth_err:
                return auth_err
            return jsonify({"status": "ok", "timestamp": _iso_now()})

        # -----------------------------------------------------------------
        # Resources
        # -----------------------------------------------------------------

        @app.route("/v1/resources", methods=["GET"])
        def list_resources():  # type: ignore[return]
            auth_err = self._check_auth()
            if auth_err:
                return auth_err
            resources = list(self._state["resources"].values())
            return jsonify({"data": resources, "total": len(resources)})

        @app.route("/v1/resources", methods=["POST"])
        def create_resource():  # type: ignore[return]
            auth_err = self._check_auth()
            if auth_err:
                return auth_err
            body = request.get_json(silent=True) or {}
            if not body.get("slug"):
                return jsonify({"error": "bad_request", "message": "'slug' is required", "status_code": 400}), 400
            existing = next(
                (r for r in self._state["resources"].values() if r["slug"] == body["slug"]),
                None,
            )
            if existing:
                return (
                    jsonify({"error": "conflict", "message": f"A resource with slug '{body['slug']}' already exists", "status_code": 409}),
                    409,
                )
            resource = _fixtures.resource(body)
            self._state["resources"][resource["id"]] = resource
            return jsonify({"data": resource}), 201

        @app.route("/v1/resources/<resource_id>", methods=["GET"])
        def get_resource(resource_id: str):  # type: ignore[return]
            auth_err = self._check_auth()
            if auth_err:
                return auth_err
            resource = self._state["resources"].get(resource_id) or next(
                (r for r in self._state["resources"].values() if r["slug"] == resource_id),
                None,
            )
            if not resource:
                return jsonify({"error": "not_found", "message": f"Resource '{resource_id}' not found", "status_code": 404}), 404
            return jsonify({"data": resource})

        @app.route("/v1/resources/<resource_id>", methods=["PATCH"])
        def update_resource(resource_id: str):  # type: ignore[return]
            auth_err = self._check_auth()
            if auth_err:
                return auth_err
            existing = self._state["resources"].get(resource_id)
            if not existing:
                return jsonify({"error": "not_found", "message": f"Resource '{resource_id}' not found", "status_code": 404}), 404
            body = request.get_json(silent=True) or {}
            updated = {**existing, **body, "id": existing["id"], "updated_at": _iso_now()}
            self._state["resources"][resource_id] = updated
            return jsonify({"data": updated})

        @app.route("/v1/resources/<resource_id>", methods=["DELETE"])
        def delete_resource(resource_id: str):  # type: ignore[return]
            auth_err = self._check_auth()
            if auth_err:
                return auth_err
            if resource_id not in self._state["resources"]:
                return jsonify({"error": "not_found", "message": f"Resource '{resource_id}' not found", "status_code": 404}), 404
            del self._state["resources"][resource_id]
            return "", 204

        # -----------------------------------------------------------------
        # Entitlements
        # -----------------------------------------------------------------

        @app.route("/v1/entitlements/check", methods=["GET"])
        def check_entitlement():  # type: ignore[return]
            auth_err = self._check_auth()
            if auth_err:
                return auth_err
            resource_id = request.args.get("resource_id")
            payer_wallet = request.args.get("payer_wallet")
            if not resource_id or not payer_wallet:
                return (
                    jsonify({"error": "bad_request", "message": "'resource_id' and 'payer_wallet' query parameters are required", "status_code": 400}),
                    400,
                )
            key = _entitlement_key(resource_id, payer_wallet)
            entitlement = self._state["entitlements"].get(key)
            return jsonify({
                "data": {
                    "entitled": bool(entitlement and entitlement["active"]),
                    "resource_id": resource_id,
                    "payer_wallet": payer_wallet,
                    "checked_at": _iso_now(),
                }
            })

        @app.route("/v1/entitlements", methods=["GET"])
        def list_entitlements():  # type: ignore[return]
            auth_err = self._check_auth()
            if auth_err:
                return auth_err
            payer_wallet = request.args.get("payer_wallet")
            entitlements = list(self._state["entitlements"].values())
            if payer_wallet:
                entitlements = [e for e in entitlements if e["payer_wallet"] == payer_wallet]
            return jsonify({"data": entitlements, "total": len(entitlements)})

        @app.route("/v1/entitlements", methods=["POST"])
        def grant_entitlement():  # type: ignore[return]
            auth_err = self._check_auth()
            if auth_err:
                return auth_err
            body = request.get_json(silent=True) or {}
            resource_id = body.get("resource_id")
            payer_wallet = body.get("payer_wallet")
            if not resource_id or not payer_wallet:
                return jsonify({"error": "bad_request", "message": "'resource_id' and 'payer_wallet' are required", "status_code": 400}), 400
            key = _entitlement_key(resource_id, payer_wallet)
            entitlement = {
                "resource_id": resource_id,
                "payer_wallet": payer_wallet,
                "active": True,
                "granted_at": _iso_now(),
                "expires_at": body.get("expires_at"),
            }
            self._state["entitlements"][key] = entitlement
            return jsonify({"data": entitlement}), 201

        @app.route("/v1/entitlements", methods=["DELETE"])
        def revoke_entitlement():  # type: ignore[return]
            auth_err = self._check_auth()
            if auth_err:
                return auth_err
            resource_id = request.args.get("resource_id")
            payer_wallet = request.args.get("payer_wallet")
            if not resource_id or not payer_wallet:
                return jsonify({"error": "bad_request", "message": "'resource_id' and 'payer_wallet' query parameters are required", "status_code": 400}), 400
            key = _entitlement_key(resource_id, payer_wallet)
            entitlement = self._state["entitlements"].get(key)
            if not entitlement:
                return jsonify({"error": "not_found", "message": "Entitlement not found", "status_code": 404}), 404
            revoked = {**entitlement, "active": False}
            self._state["entitlements"][key] = revoked
            return jsonify({"data": revoked})

        # -----------------------------------------------------------------
        # Payments
        # -----------------------------------------------------------------

        @app.route("/v1/payments", methods=["POST"])
        def create_payment():  # type: ignore[return]
            auth_err = self._check_auth()
            if auth_err:
                return auth_err
            body = request.get_json(silent=True) or {}
            resource_id = body.get("resource_id")
            payer_wallet = body.get("payer_wallet")
            if not resource_id or not payer_wallet:
                return jsonify({"error": "bad_request", "message": "'resource_id' and 'payer_wallet' are required", "status_code": 400}), 400
            resource = self._state["resources"].get(resource_id)
            if not resource:
                return jsonify({"error": "not_found", "message": f"Resource '{resource_id}' not found", "status_code": 404}), 404
            payment = _fixtures.payment({
                "resource_id": resource_id,
                "payer_wallet": payer_wallet,
                "vendor_id": resource["vendor_id"],
                "amount": body.get("amount", resource["price_per_call"]),
                "currency": "USD",
                "status": "completed",
                "metadata": body.get("metadata", {}),
            })
            self._state["payments"].append(payment)
            # Auto-grant entitlement
            key = _entitlement_key(resource_id, payer_wallet)
            self._state["entitlements"][key] = {
                "resource_id": resource_id,
                "payer_wallet": payer_wallet,
                "active": True,
                "granted_at": _iso_now(),
                "expires_at": None,
            }
            return jsonify({"data": payment}), 201

        @app.route("/v1/payments", methods=["GET"])
        def list_payments():  # type: ignore[return]
            auth_err = self._check_auth()
            if auth_err:
                return auth_err
            payments = list(self._state["payments"])
            resource_id = request.args.get("resource_id")
            payer_wallet = request.args.get("payer_wallet")
            if resource_id:
                payments = [p for p in payments if p["resource_id"] == resource_id]
            if payer_wallet:
                payments = [p for p in payments if p["payer_wallet"] == payer_wallet]
            return jsonify({"data": payments, "total": len(payments)})

        @app.route("/v1/payments/<payment_id>", methods=["GET"])
        def get_payment(payment_id: str):  # type: ignore[return]
            auth_err = self._check_auth()
            if auth_err:
                return auth_err
            payment = next((p for p in self._state["payments"] if p["id"] == payment_id), None)
            if not payment:
                return jsonify({"error": "not_found", "message": f"Payment '{payment_id}' not found", "status_code": 404}), 404
            return jsonify({"data": payment})

        # -----------------------------------------------------------------
        # Users / Vendors
        # -----------------------------------------------------------------

        @app.route("/v1/users/me", methods=["GET"])
        def get_me():  # type: ignore[return]
            auth_err = self._check_auth()
            if auth_err:
                return auth_err
            api_key = request.headers.get("Authorization", "")[7:]
            vendor = next(
                (v for v in self._state["vendors"].values() if v["api_key"] == api_key),
                None,
            )
            if not vendor:
                vendor = _fixtures.vendor({"api_key": api_key or "sk_test_mock"})
            return jsonify({"data": vendor})

        @app.route("/v1/users/<user_id>", methods=["GET"])
        def get_user(user_id: str):  # type: ignore[return]
            auth_err = self._check_auth()
            if auth_err:
                return auth_err
            vendor = self._state["vendors"].get(user_id)
            if not vendor:
                return jsonify({"error": "not_found", "message": f"User '{user_id}' not found", "status_code": 404}), 404
            return jsonify({"data": vendor})

        # -----------------------------------------------------------------
        # 404 catch-all
        # -----------------------------------------------------------------

        @app.errorhandler(404)
        def not_found_handler(_err: Any):  # type: ignore[return]
            return jsonify({"error": "not_found", "message": "Endpoint not found", "status_code": 404}), 404

        return app
