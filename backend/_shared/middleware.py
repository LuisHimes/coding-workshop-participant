"""
ASGI middleware for the API, outermost first:

1. RequestLoggingMiddleware writes one JSON log line per request (method,
   path, status, duration, user, request ID) and adds the X-Request-ID header.
2. SecurityHeadersMiddleware stops responses, which carry salaries and login
   tokens, from being cached or misinterpreted by browsers.
3. ExceptionHandlerMiddleware turns any exception that escapes a route into a
   JSON error response, so controllers never catch errors themselves.
4. FeaturePathMiddleware maps the path a request arrives on to the app's
   routes, which are declared with their full path (/projects/{id}).

All are pure ASGI rather than BaseHTTPMiddleware, so they see exceptions
directly and don't buffer responses. Register them with add_middleware(app).
"""

import json
import logging
import time
import uuid

from psycopg import OperationalError
from psycopg import errors as pg_errors

from services.errors import ConflictError, InvalidRequestError, NotFoundError, PermissionDeniedError, ServiceError

logger = logging.getLogger(__name__)


def add_middleware(app, feature: str | None = None) -> None:
    """Registers the middleware in order. The last one added runs first."""
    app.add_middleware(FeaturePathMiddleware, feature=feature)
    app.add_middleware(ExceptionHandlerMiddleware)
    app.add_middleware(SecurityHeadersMiddleware)
    app.add_middleware(RequestLoggingMiddleware)


def request_id_for(scope) -> str:
    """
    The request's ID, created on first use and kept in the request state. On
    Lambda it is AWS's request ID, so responses match CloudWatch logs.
    """
    state = scope.setdefault("state", {})
    if "request_id" not in state:
        aws_context = scope.get("aws.context")
        state["request_id"] = getattr(aws_context, "aws_request_id", None) or uuid.uuid4().hex
    return state["request_id"]


def add_headers(message: dict, headers: dict[bytes, bytes]) -> None:
    """Adds headers to a response start message, keeping any the app already set."""
    existing = {name.lower() for name, _ in message.get("headers", [])}
    message["headers"] = [*message.get("headers", []),
                          *((name, value) for name, value in headers.items() if name not in existing)]


# Request logging


class RequestLoggingMiddleware:
    """Logs every request as one JSON line, and tags the response with its request ID."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        request_id = request_id_for(scope)
        started = time.perf_counter()
        status = 500  # if the app fails before responding

        async def send_and_record(message):
            nonlocal status
            if message["type"] == "http.response.start":
                status = message["status"]
                add_headers(message, {b"x-request-id": request_id.encode()})
            await send(message)

        try:
            await self.app(scope, receive, send_and_record)
        finally:
            level = logging.ERROR if status >= 500 else logging.INFO
            logger.log(level, json.dumps({
                "event": "request",
                "request_id": request_id,
                "method": scope["method"],
                "path": scope["path"],
                "status": status,
                "duration_ms": round((time.perf_counter() - started) * 1000, 1),
                # Set by the login dependency once it knows who is calling
                "user_id": scope["state"].get("user_id"),
            }))


# Security headers

SECURITY_HEADERS = {
    # Responses include salaries and tokens: never store them
    b"cache-control": b"no-store",
    # Browsers must trust the declared Content-Type instead of guessing
    b"x-content-type-options": b"nosniff",
    # Don't leak API URLs to other sites, and don't allow the API inside frames
    b"referrer-policy": b"no-referrer",
    b"content-security-policy": b"frame-ancestors 'none'",
    # Keep using HTTPS for a year once seen over HTTPS (ignored over plain HTTP)
    b"strict-transport-security": b"max-age=31536000",
}


class SecurityHeadersMiddleware:
    """Adds SECURITY_HEADERS to every response, unless a route set its own value."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        async def send_with_headers(message):
            if message["type"] == "http.response.start":
                add_headers(message, SECURITY_HEADERS)
            await send(message)

        await self.app(scope, receive, send_with_headers)


# Exception handling

# Service errors carry messages written for the user, so they are passed through
SERVICE_ERROR_STATUS = {
    NotFoundError: 404,
    PermissionDeniedError: 403,
    ConflictError: 409,
    InvalidRequestError: 400,
}


def error_response(exc: Exception, request_id: str) -> tuple[int, dict]:
    """The status code and JSON body for an exception, logging it as appropriate."""
    if isinstance(exc, ServiceError):
        status = next((code for cls, code in SERVICE_ERROR_STATUS.items() if isinstance(exc, cls)), 400)
        return status, {"detail": exc.message}
    if isinstance(exc, OperationalError):
        logger.error("Database unavailable [request %s]: %s", request_id, exc)
        return 503, {"detail": "The database is unavailable; try again shortly", "request_id": request_id}
    if isinstance(exc, pg_errors.IntegrityError):
        # Services translate rule violations; reaching here means one slipped through
        logger.warning("Unhandled database rule violation [request %s]: %s", request_id, exc)
        return 409, {"detail": "This change conflicts with existing data", "request_id": request_id}
    # Anything else is a bug: log the traceback, but never send internals to the client
    logger.exception("Unhandled error [request %s]", request_id, exc_info=exc)
    return 500, {"detail": "Something went wrong on our side", "request_id": request_id}


class ExceptionHandlerMiddleware:
    """Catches exceptions from the rest of the app and returns them as JSON errors."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        response_started = False

        async def send_and_track(message):
            nonlocal response_started
            if message["type"] == "http.response.start":
                response_started = True
            await send(message)

        try:
            await self.app(scope, receive, send_and_track)
        except Exception as exc:
            request_id = request_id_for(scope)
            if response_started:
                # Part of the response is already sent; it can't be replaced with an error
                logger.exception("Error after the response started [request %s]", request_id)
                raise
            status, body = error_response(exc, request_id)
            await send({
                "type": "http.response.start",
                "status": status,
                "headers": [(b"content-type", b"application/json")],
            })
            await send({"type": "http.response.body", "body": json.dumps(body).encode()})


# Paths


class FeaturePathMiddleware:
    """
    Maps the path a request arrives on to the app's routes. For the projects
    feature, /projects/12 is reached as:
      AWS (CloudFront forwards the full path):           /api/projects/12
      Local (proxy-server.js strips /api/<feature>):     /12
      Directly (tests, uvicorn):                         /projects/12
    """

    def __init__(self, app, feature: str | None = None):
        self.app = app
        self.prefix = f"/{feature}" if feature else None

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http":
            path = scope["path"]
            if path == "/api" or path.startswith("/api/"):
                path = path[len("/api"):] or "/"
            if self.prefix and not (path == self.prefix or path.startswith(self.prefix + "/")):
                path = self.prefix + ("" if path == "/" else path)
            scope = {**scope, "path": path, "raw_path": path.encode()}
        await self.app(scope, receive, send)
