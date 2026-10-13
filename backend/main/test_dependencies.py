"""
Tests for the dependency injection wiring in dependencies.py.

Run from the service folder: pytest
"""

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app import app
from database import get_db
from dependencies import ProjectRepositoryDep, get_project_repository
from repository.projects import ProjectRepository


@pytest.fixture
def overrides():
    """Restores the app's real providers after each test."""
    yield app.dependency_overrides
    app.dependency_overrides.clear()


def test_overriding_get_db_changes_the_connection_routes_use(db, overrides):
    db.execute("CREATE TABLE marker (id int)")
    overrides[get_db] = lambda: db
    assert TestClient(app).get("/health/db").json()["status"] == "ok"
    # The route ran on the test schema's connection, which has the marker table
    assert db.execute("SELECT to_regclass('marker') IS NOT NULL AS found").fetchone()["found"]


def make_test_app():
    test_app = FastAPI()

    @test_app.get("/projects")
    def list_projects(projects: ProjectRepositoryDep):
        return {"repository": type(projects).__name__, "projects": projects.find()}

    return test_app


def test_repository_provider_builds_repository_on_the_injected_connection(db):
    test_app = make_test_app()
    test_app.dependency_overrides[get_db] = lambda: db
    body = TestClient(test_app).get("/projects").json()
    assert body == {"repository": "ProjectRepository", "projects": []}


def test_repository_provider_can_be_replaced_with_a_fake():
    class FakeProjectRepository(ProjectRepository):
        def __init__(self):
            super().__init__(db=None)

        def find(self, **filters):
            return [{"id": 1, "name": "Fake project"}]

    test_app = make_test_app()
    test_app.dependency_overrides[get_project_repository] = FakeProjectRepository
    body = TestClient(test_app).get("/projects").json()
    assert body == {"repository": "FakeProjectRepository", "projects": [{"id": 1, "name": "Fake project"}]}
