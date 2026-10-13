"""
Tests for routing and the Lambda handler.

Run from the service folder: pytest
"""

import json

import pytest
from fastapi.testclient import TestClient

from app import app
from function import handler

client = TestClient(app)


@pytest.mark.parametrize("path", ["/health", "/api/main/health"])
def test_health_with_and_without_api_prefix(path):
    response = client.get(path)
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_lambda_function_url_event():
    event = {
        "version": "2.0",
        "routeKey": "$default",
        "rawPath": "/api/main/health",
        "rawQueryString": "",
        "headers": {"host": "example.lambda-url.us-east-1.on.aws"},
        "requestContext": {
            "http": {
                "method": "GET",
                "path": "/api/main/health",
                "protocol": "HTTP/1.1",
                "sourceIp": "127.0.0.1",
                "userAgent": "pytest",
            },
        },
        "isBase64Encoded": False,
    }
    response = handler(event, None)
    assert response["statusCode"] == 200
    assert json.loads(response["body"]) == {"status": "ok"}
