"""
Tests for connection management: reusing the connection across requests,
reconnecting after failures, and the get_db dependency.

Connections are faked or replaced with the test schema's connection (see the
db fixture in conftest.py), so no real infrastructure is broken.
Run from backend/_shared: pytest
"""

from types import SimpleNamespace

import pytest
from psycopg import OperationalError

import database
from config import settings
from database import create_schema, get_connection, get_db
from repositories.users import UserRepository


@pytest.fixture
def fresh_pool(monkeypatch):
    """No pooled connection yet; restored after the test."""
    monkeypatch.setattr(database, "PG_CONN", None)


def fake_connection(broken=False, closed=False):
    return SimpleNamespace(broken=broken, closed=closed)


# Schema setup under concurrency


def test_a_cold_start_that_waited_for_the_lock_skips_the_setup(db):
    # Another cold start applied the schema while this one waited for the lock
    assert create_schema(db, only_if_changed=True) is False


# get_connection


def test_get_connection_connects_once_and_reuses_the_connection(db, fresh_pool, monkeypatch):
    calls = []
    monkeypatch.setattr(database, "connect", lambda *args, **kwargs: calls.append(kwargs) or db)
    monkeypatch.setattr(settings, "initial_admin_password", "first admin password")

    assert get_connection() is db
    assert get_connection() is db
    assert len(calls) == 1
    assert calls[0]["autocommit"] is True  # ensure_schema needs autocommit
    # The first cold start also creates the initial admin
    assert [u["id"] for u in UserRepository(db).find(role="admin")] == [settings.initial_admin_id]


def test_get_connection_replaces_a_closed_connection(db, monkeypatch):
    monkeypatch.setattr(database, "PG_CONN", fake_connection(closed=True))
    monkeypatch.setattr(database, "connect", lambda *args, **kwargs: db)
    assert get_connection() is db
    assert database.PG_CONN is db


# get_db


def test_get_db_clears_the_previous_requests_audit_actor(db, monkeypatch):
    monkeypatch.setattr(database, "get_connection", lambda: db)
    db.execute("SELECT set_config('app.user_id', 'EMP001', false)")
    dependency = get_db()
    assert next(dependency) is db
    assert db.execute("SELECT current_setting('app.user_id') AS actor").fetchone()["actor"] == ""
    dependency.close()


def test_get_db_drops_a_broken_connection_so_the_next_request_reconnects(monkeypatch):
    broken = fake_connection(broken=True)
    monkeypatch.setattr(database, "PG_CONN", broken)

    def lost():
        raise OperationalError("server closed the connection unexpectedly")

    monkeypatch.setattr(database, "get_connection", lost)
    with pytest.raises(OperationalError):
        next(get_db())
    assert database.PG_CONN is None


def test_get_db_keeps_a_healthy_connection_when_a_request_fails(monkeypatch):
    healthy = SimpleNamespace(broken=False, closed=False, execute=lambda *args: None)
    monkeypatch.setattr(database, "PG_CONN", healthy)
    monkeypatch.setattr(database, "get_connection", lambda: healthy)
    dependency = get_db()
    next(dependency)
    # An error raised by the route is passed back into the dependency
    with pytest.raises(ValueError):
        dependency.throw(ValueError("route failed"))
    assert database.PG_CONN is healthy


def test_get_db_reraises_when_the_first_connection_fails(fresh_pool, monkeypatch):
    def unreachable(*args, **kwargs):
        raise OperationalError("connection refused")

    monkeypatch.setattr(database, "connect", unreachable)
    with pytest.raises(OperationalError, match="refused"):
        next(get_db())
    assert database.PG_CONN is None
