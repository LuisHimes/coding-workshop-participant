"""
Tests for the middleware: request logging, security headers and exception handling.

Run from the service folder: pytest
"""

import asyncio
import json
import logging
from types import SimpleNamespace

import pytest
from fastapi import FastAPI, Response
from fastapi.testclient import TestClient
from psycopg import OperationalError
from psycopg import errors as pg_errors

from app import app
from database import get_db
from middleware import ExceptionHandlerMiddleware, RequestLoggingMiddleware, SECURITY_HEADERS, add_middleware
from repository.users import UserRepository
from service.errors import ConflictError, InvalidRequestError, NotFoundError, PermissionDeniedError
from service.security import hash_password


def make_client(error: Exception | None = None) -> TestClient:
    """An app with the full middleware stack and a route that raises the given error."""
    test_app = FastAPI()
    add_middleware(test_app)

    @test_app.get("/fails")
    def fails():
        raise error

    @test_app.get("/works")
    def works():
        return {"ok": True}

    @test_app.get("/cacheable")
    def cacheable():
        return Response("{}", media_type="application/json", headers={"Cache-Control": "max-age=60"})

    return TestClient(test_app)


def request_logs(caplog) -> list[dict]:
    return [json.loads(r.getMessage()) for r in caplog.records if r.getMessage().startswith('{"event": "request"')]


# Exception handling


@pytest.mark.parametrize("error, status_code", [
    (NotFoundError("Project not found"), 404),
    (PermissionDeniedError("You do not have permission to do this"), 403),
    (ConflictError("Project is already archived"), 409),
    (InvalidRequestError("end_date must be on or after start_date"), 400),
])
def test_service_errors_keep_their_message(error, status_code):
    response = make_client(error).get("/fails")
    assert response.status_code == status_code
    assert response.json() == {"detail": error.message}


def test_unexpected_errors_are_logged_but_not_revealed(caplog):
    with caplog.at_level(logging.ERROR, logger="middleware"):
        response = make_client(RuntimeError("password=hunter2 in a SQL string")).get("/fails")
    assert response.status_code == 500
    body = response.json()
    assert body["detail"] == "Something went wrong on our side"
    assert "hunter2" not in response.text
    assert body["request_id"] == response.headers["X-Request-ID"]
    # The traceback, with the real cause, is in the logs under the same request ID
    [traceback] = [r for r in caplog.records if r.exc_info]
    assert body["request_id"] in traceback.getMessage()
    assert "hunter2" in str(traceback.exc_info[1])


def test_database_outages_return_503():
    response = make_client(OperationalError("connection refused")).get("/fails")
    assert response.status_code == 503
    assert response.json()["detail"] == "The database is unavailable; try again shortly"


def test_unhandled_database_rule_violations_return_409():
    response = make_client(pg_errors.UniqueViolation("duplicate key")).get("/fails")
    assert response.status_code == 409
    assert response.json()["detail"] == "This change conflicts with existing data"


def test_http_errors_are_left_to_fastapi():
    assert make_client().get("/missing").json() == {"detail": "Not Found"}


def test_errors_after_the_response_started_are_reraised():
    async def streaming_app(scope, receive, send):
        await send({"type": "http.response.start", "status": 200, "headers": []})
        raise RuntimeError("stream broke")

    async def send(message):
        pass

    with pytest.raises(RuntimeError, match="stream broke"):
        asyncio.run(ExceptionHandlerMiddleware(streaming_app)({"type": "http"}, None, send))


# Request IDs and logging


def test_every_response_has_its_own_request_id():
    client = make_client()
    first, second = client.get("/works"), client.get("/works")
    assert first.json() == {"ok": True}
    assert first.headers["X-Request-ID"] != second.headers["X-Request-ID"]


def test_lambda_requests_reuse_the_aws_request_id():
    async def failing_app(scope, receive, send):
        raise RuntimeError("boom")

    sent = []

    async def send(message):
        sent.append(message)

    scope = {"type": "http", "method": "GET", "path": "/x", "aws.context": SimpleNamespace(aws_request_id="aws-123")}
    asyncio.run(RequestLoggingMiddleware(ExceptionHandlerMiddleware(failing_app))(scope, None, send))
    assert (b"x-request-id", b"aws-123") in sent[0]["headers"]
    assert json.loads(sent[1]["body"])["request_id"] == "aws-123"


def test_each_request_is_logged_as_one_json_line(caplog):
    with caplog.at_level(logging.INFO, logger="middleware"):
        response = make_client().get("/works?q=x")
    [log] = request_logs(caplog)
    assert log["request_id"] == response.headers["X-Request-ID"]
    assert (log["method"], log["path"], log["status"], log["user_id"]) == ("GET", "/works", 200, None)
    assert log["duration_ms"] >= 0


def test_server_errors_are_logged_as_errors(caplog):
    with caplog.at_level(logging.INFO, logger="middleware"):
        make_client(RuntimeError("boom")).get("/fails")
    [record] = [r for r in caplog.records if r.getMessage().startswith('{"event": "request"')]
    assert record.levelno == logging.ERROR
    assert json.loads(record.getMessage())["status"] == 500


def test_request_logs_name_the_logged_in_user(db, caplog):
    UserRepository(db).create({
        "id": "ADMIN9", "role": "admin", "first_name": "Ada", "last_name": "Admin", "email": "ada@example.com",
        "job_title": "Administrator", "password_hash": hash_password("a long password"), "must_change_password": False,
    })
    app.dependency_overrides[get_db] = lambda: db
    try:
        client = TestClient(app)
        token = client.post("/auth/token", data={"username": "ada@example.com", "password": "a long password"}).json()
        with caplog.at_level(logging.INFO, logger="middleware"):
            client.get("/api/auth/me", headers={"Authorization": f"Bearer {token['access_token']}"})
    finally:
        app.dependency_overrides.clear()
    [log] = [entry for entry in request_logs(caplog) if entry["path"] == "/api/auth/me"]
    assert (log["status"], log["user_id"]) == (200, "ADMIN9")


# Security headers


@pytest.mark.parametrize("path, error", [("/works", None), ("/fails", RuntimeError("boom")), ("/missing", None)])
def test_security_headers_are_on_every_response(path, error):
    response = make_client(error).get(path)
    for name, value in SECURITY_HEADERS.items():
        assert response.headers[name.decode()] == value.decode()


def test_routes_can_set_their_own_cache_policy():
    response = make_client().get("/cacheable")
    assert response.headers.get_list("cache-control") == ["max-age=60"]
