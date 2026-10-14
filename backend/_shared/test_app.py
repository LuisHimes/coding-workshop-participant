"""
Tests for the feature apps: routing, paths and the Lambda handler.

Run from backend/_shared: pytest
"""

import json
import shutil
import subprocess
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from mangum import Mangum

import sync
from app import FEATURES, app, create_app

BACKEND_DIR = Path(__file__).resolve().parent.parent


def paths(application) -> set[str]:
    return set(application.openapi()["paths"])


def test_each_feature_serves_only_routes_under_its_name():
    for feature in FEATURES:
        assert all(path.startswith(f"/{feature}/") or path == f"/{feature}"
                   for path in paths(create_app(feature))), feature


def test_every_route_is_served_by_exactly_one_feature():
    feature_paths = [paths(create_app(feature)) - {f"/{feature}/health", f"/{feature}/health/db"} for feature in FEATURES]
    combined = set().union(*feature_paths)
    assert sum(len(p) for p in feature_paths) == len(combined), "a route is served by two features"
    assert combined == paths(app) - {"/health", "/health/db"}, "a route isn't served by any feature"


@pytest.mark.parametrize("path", [
    "/api/projects/health",  # AWS: CloudFront forwards the full path
    "/health",               # Local: proxy-server.js strips /api/projects
    "/projects/health",      # Directly
])
def test_feature_apps_accept_every_path_shape(path):
    assert TestClient(create_app("projects")).get(path).json() == {"status": "ok"}


def test_feature_apps_dont_serve_other_features():
    client = TestClient(create_app("projects"))
    assert client.post("/api/users/ABC123/reset-password").status_code == 404
    assert client.post("/users/ABC123/reset-password").status_code == 404


@pytest.mark.parametrize("path", ["/health", "/api/health"])
def test_the_combined_app_serves_everything(path):
    assert TestClient(app).get(path).json() == {"status": "ok"}


def test_unknown_features_are_rejected():
    with pytest.raises(ValueError, match="Unknown feature"):
        create_app("payroll")


def test_lambda_function_url_event():
    event = {
        "version": "2.0",
        "routeKey": "$default",
        "rawPath": "/api/projects/health",
        "rawQueryString": "",
        "headers": {"host": "example.lambda-url.us-east-1.on.aws"},
        "requestContext": {
            "http": {"method": "GET", "path": "/api/projects/health", "protocol": "HTTP/1.1",
                     "sourceIp": "127.0.0.1", "userAgent": "pytest"},
        },
        "isBase64Encoded": False,
    }
    response = Mangum(create_app("projects"), lifespan="off")(event, None)
    assert response["statusCode"] == 200
    assert json.loads(response["body"]) == {"status": "ok"}


# Feature folders


def test_every_feature_has_a_lambda_folder_naming_it():
    folders = {p.parent.name: p.read_text() for p in BACKEND_DIR.glob("*/function.py")
               if not p.parent.name.startswith("_")}
    assert set(folders) == set(FEATURES)
    for feature, source in folders.items():
        assert f'create_app("{feature}")' in source, feature


def test_feature_folders_have_the_shared_requirements():
    shared = (BACKEND_DIR / "_shared" / "requirements.txt").read_text()
    for feature in FEATURES:
        assert (BACKEND_DIR / feature / "requirements.txt").read_text() == shared, feature


def test_sync_copies_the_shared_code_and_removes_stale_files(tmp_path):
    target = tmp_path / "projects"
    target.mkdir()
    (target / "function.py").write_text("# feature entry point")
    (target / sync.MANIFEST).write_text(json.dumps(["models/retired.py"]))
    (target / "models").mkdir()
    (target / "models" / "retired.py").write_text("# deleted from _shared")

    sync.sync_feature(target, sync.shared_files())

    assert (target / "app.py").read_text() == (sync.SHARED_DIR / "app.py").read_text()
    assert (target / "service" / "projects.py").exists()
    assert (target / "migrations" / "002_add_search_and_lookup_indexes.sql").exists()
    assert not (target / "models" / "retired.py").exists()
    assert (target / "function.py").read_text() == "# feature entry point"  # never overwritten
    assert not list(target.glob("test_*.py"))
    assert not (target / "sync.py").exists()


def test_sync_leaves_installed_packages_and_tests_behind():
    copied = {str(p) for p in sync.shared_files()}
    assert "app.py" in copied and "requirements.txt" in copied
    assert not any(p.startswith(("test_", "fastapi", "pydantic", "typing_extensions")) for p in copied)
    assert shutil.which("python3")  # Terraform runs sync.py with python3


def test_feature_lambdas_load_only_their_own_controller():
    # A fresh interpreter, as on a Lambda cold start
    code = ("import sys; from app import create_app; create_app('projects'); "
            "print(','.join(sorted(m for m in sys.modules if m.startswith('controller.'))))")
    loaded = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True,
                            cwd=Path(__file__).parent, check=True).stdout.strip()
    assert loaded == "controller.health,controller.projects"


def test_running_app_py_starts_the_whole_api_locally(monkeypatch):
    # Run app.py's real code as __main__ with uvicorn.run replaced, so no server starts
    import logging

    import uvicorn

    from config import settings

    calls = []
    monkeypatch.setattr(uvicorn, "run", lambda *args, **kwargs: calls.append((args, kwargs)))
    root = logging.getLogger()
    monkeypatch.setattr(root, "level", root.level)  # restored after the test
    source = Path(__file__).parent / "app.py"
    exec(compile(source.read_text(), str(source), "exec"), {"__name__": "__main__"})
    assert calls == [(("app:app",), {"host": "0.0.0.0", "port": 8000, "reload": True})]
    assert root.level == logging.getLevelName(settings.log_level)
