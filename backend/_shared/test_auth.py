"""
Tests for logging in, tokens, passwords and role guards.

Run from the service folder: pytest
"""

from datetime import UTC, datetime, timedelta
from decimal import Decimal

import jwt
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from config import settings
from controller import auth
from database import get_db
from dependencies import AdminUser, CurrentUser, ManagerOrAdminUser
from repository.audit import AuditRepository
from repository.users import UserRepository
from service.auth import ensure_initial_admin
from service.security import hash_password, verify_password

PASSWORD = "correct horse battery"


@pytest.fixture
def client(db):
    app = FastAPI()
    app.include_router(auth.router)

    @app.get("/anyone")
    def anyone(user: CurrentUser):
        return {"id": user["id"]}

    @app.get("/admins")
    def admins(user: AdminUser):
        return {"id": user["id"]}

    @app.get("/managers")
    def managers(user: ManagerOrAdminUser):
        return {"id": user["id"]}

    app.dependency_overrides[get_db] = lambda: db
    return TestClient(app)


@pytest.fixture
def people(db):
    users = UserRepository(db)

    def create(user_id, role, manager_id=None, must_change_password=False):
        return users.create({
            "id": user_id, "role": role, "first_name": "Test", "last_name": role.title(),
            "email": f"{user_id.lower()}@example.com", "job_title": role.title(),
            "salary": Decimal("80000") if role != "admin" else None, "manager_id": manager_id,
            "password_hash": hash_password(PASSWORD), "must_change_password": must_change_password,
        })

    return {
        "admin": create("ADMIN2", "admin"),
        "manager": create("MGR001", "manager"),
        "employee": create("EMP001", "employee", "MGR001"),
        "new_hire": create("EMP002", "employee", "MGR001", must_change_password=True),
    }


def login(client, email, password=PASSWORD):
    return client.post("/auth/token", data={"username": email, "password": password})


def bearer(token):
    return {"Authorization": f"Bearer {token}"}


def email_of(user_id):
    return f"{user_id.lower()}@example.com"


def token_for(client, user_id):
    return login(client, email_of(user_id)).json()["access_token"]


# Passwords


def test_password_hashes_are_salted_and_verifiable():
    first, second = hash_password(PASSWORD), hash_password(PASSWORD)
    assert first != second and first.startswith("scrypt$")
    assert verify_password(PASSWORD, first)
    assert not verify_password("wrong", first)
    assert not verify_password(PASSWORD, "not-a-hash")


# Logging in


def test_login_returns_a_bearer_token(client, people):
    response = login(client, "  EMP001@Example.COM ")  # emails ignore case and spaces at login
    assert response.status_code == 200
    body = response.json()
    assert body["token_type"] == "bearer"
    assert body["must_change_password"] is False
    assert body["expires_in"] == settings.jwt_access_token_expire_minutes * 60
    claims = jwt.decode(body["access_token"], settings.jwt_secret, algorithms=[settings.jwt_algorithm],
                        issuer=settings.jwt_issuer)
    assert (claims["sub"], claims["role"]) == ("EMP001", "employee")


@pytest.mark.parametrize("email, password", [("emp001@example.com", "wrong password"), ("nobody@example.com", PASSWORD)])
def test_failed_logins_get_the_same_error(client, people, email, password):
    response = login(client, email, password)
    assert response.status_code == 401
    assert response.json() == {"detail": "Incorrect email or password"}


def test_user_ids_no_longer_log_in(client, people):
    assert login(client, "EMP001").status_code == 401


def test_deactivated_users_cannot_log_in(client, people, db):
    UserRepository(db).update("EMP001", {"is_active": False})
    assert login(client, email_of("EMP001")).status_code == 401


def test_logins_are_audited(client, people, db):
    login(client, "EMP001@example.com")
    login(client, "emp001@example.com", "wrong password")
    audit = AuditRepository(db)
    assert [(e["action"], e["actor_id"]) for e in audit.find(entity="users", entity_id="EMP001")][:1] == [("LOGIN", "EMP001")]
    # Failed attempts are recorded under the email tried, as it may not belong to anyone
    assert [(e["action"], e["actor_id"]) for e in audit.find(entity="users", entity_id="emp001@example.com")] == [
        ("LOGIN_FAILED", None)]


# Using the token


def test_me_returns_the_logged_in_user(client, people):
    response = client.get("/auth/me", headers=bearer(token_for(client, "MGR001")))
    assert response.status_code == 200
    assert response.json()["id"] == "MGR001"
    assert response.json()["salary"] == "80000.00"


def test_employees_do_not_see_salaries(client, people):
    body = client.get("/auth/me", headers=bearer(token_for(client, "EMP001"))).json()
    assert body["id"] == "EMP001"
    assert "salary" not in body


def test_missing_invalid_and_expired_tokens_are_rejected(client, people):
    assert client.get("/auth/me").status_code == 401
    assert client.get("/auth/me", headers=bearer("not-a-token")).status_code == 401

    expired = jwt.encode(
        {"sub": "EMP001", "role": "employee", "iss": settings.jwt_issuer,
         "iat": datetime.now(UTC) - timedelta(hours=2), "exp": datetime.now(UTC) - timedelta(hours=1)},
        settings.jwt_secret, algorithm=settings.jwt_algorithm)
    assert client.get("/auth/me", headers=bearer(expired)).status_code == 401

    forged = jwt.encode(
        {"sub": "ADMIN2", "role": "admin", "iss": settings.jwt_issuer,
         "iat": datetime.now(UTC), "exp": datetime.now(UTC) + timedelta(hours=1)},
        "x" * 32, algorithm=settings.jwt_algorithm)
    assert client.get("/auth/me", headers=bearer(forged)).status_code == 401


def test_deactivating_a_user_invalidates_their_token(client, people, db):
    token = token_for(client, "EMP001")
    UserRepository(db).update("EMP001", {"is_active": False})
    assert client.get("/auth/me", headers=bearer(token)).status_code == 401


def test_requests_record_the_user_in_the_audit_log(client, people, db):
    token = token_for(client, "EMP001")
    client.get("/anyone", headers=bearer(token))
    UserRepository(db).update("EMP001", {"first_name": "Grace"})
    assert AuditRepository(db).find(entity="users", entity_id="EMP001")[0]["actor_id"] == "EMP001"


# Roles


@pytest.mark.parametrize("user_id, admins, managers", [
    ("ADMIN2", 200, 200),
    ("MGR001", 403, 200),
    ("EMP001", 403, 403),
])
def test_role_guards(client, people, user_id, admins, managers):
    headers = bearer(token_for(client, user_id))
    assert client.get("/anyone", headers=headers).status_code == 200
    assert client.get("/admins", headers=headers).status_code == admins
    assert client.get("/managers", headers=headers).status_code == managers


# Temporary passwords


def test_temporary_password_must_be_changed_before_anything_else(client, people):
    body = login(client, email_of("EMP002")).json()
    assert body["must_change_password"] is True
    headers = bearer(body["access_token"])
    assert client.get("/anyone", headers=headers).status_code == 403
    assert client.get("/auth/me", headers=headers).status_code == 200

    change = {"current_password": PASSWORD, "new_password": "a brand new password"}
    assert client.post("/auth/change-password", json=change, headers=headers).status_code == 204
    assert client.get("/anyone", headers=headers).status_code == 200
    assert login(client, email_of("EMP002")).status_code == 401
    assert login(client, email_of("EMP002"), "a brand new password").json()["must_change_password"] is False


def test_change_password_checks_the_current_password(client, people):
    headers = bearer(token_for(client, "EMP001"))
    wrong = {"current_password": "wrong password", "new_password": "a brand new password"}
    same = {"current_password": PASSWORD, "new_password": PASSWORD}
    short = {"current_password": PASSWORD, "new_password": "short"}
    assert client.post("/auth/change-password", json=wrong, headers=headers).status_code == 400
    assert client.post("/auth/change-password", json=same, headers=headers).status_code == 400
    assert client.post("/auth/change-password", json=short, headers=headers).status_code == 422


# First admin


def test_initial_admin_is_created_once(db, monkeypatch):
    monkeypatch.setattr(settings, "initial_admin_password", "initial-admin-password")
    users = UserRepository(db)
    ensure_initial_admin(users)
    ensure_initial_admin(users)
    admins = users.find(role="admin")
    assert [a["id"] for a in admins] == [settings.initial_admin_id]
    assert admins[0]["must_change_password"] is True
    assert verify_password("initial-admin-password", users.get_credentials(settings.initial_admin_id)["password_hash"])


def test_initial_admin_is_skipped_without_a_password(db, monkeypatch):
    monkeypatch.setattr(settings, "initial_admin_password", None)
    users = UserRepository(db)
    ensure_initial_admin(users)
    assert users.find(role="admin") == []


@pytest.mark.parametrize("stored", ["bcrypt$16384$8$1$c2FsdA==$aGFzaA==", "scrypt$x$8$1$c2FsdA==$aGFzaA==", ""])
def test_unknown_or_malformed_hashes_never_verify(stored):
    assert verify_password(PASSWORD, stored) is False
