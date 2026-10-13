"""
End-to-end tests of the HTTP API: routes, status codes and the full project
lifecycle, through the real app with each role logged in.

Each test runs in its own temporary schema (see the db fixture in conftest.py).
Run from the service folder: pytest
"""

import re
from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient

from app import app
from database import get_db
from repository.users import UserRepository
from service.security import hash_password

TODAY = date.today()
PASSWORD = "permanent password"
PUBLIC_ROUTES = {"/health", "/health/db", "/auth/token"}


@pytest.fixture
def client(db):
    app.dependency_overrides[get_db] = lambda: db
    yield TestClient(app)
    app.dependency_overrides.clear()


@pytest.fixture
def admin(db, client):
    UserRepository(db).create({
        "id": "ADMIN9", "role": "admin", "first_name": "Ada", "last_name": "Admin", "email": "ada@example.com",
        "job_title": "Administrator", "password_hash": hash_password(PASSWORD), "must_change_password": False,
    })
    return log_in(client, "ada@example.com")


def log_in(client, email, password=PASSWORD):
    response = client.post("/auth/token", data={"username": email, "password": password})
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def new_user(client, admin, role, first_name, manager_id=None):
    """Creates a user as the admin, then logs them in and replaces their temporary password."""
    body = {"role": role, "first_name": first_name, "last_name": "Test", "email": f"{first_name.lower()}@example.com",
            "job_title": role.title(), "salary": "104000", "manager_id": manager_id}
    created = client.post("/users", json=body, headers=admin)
    assert created.status_code == 201, created.text
    user_id, temporary = created.json()["user"]["id"], created.json()["temporary_password"]
    headers = log_in(client, body["email"], temporary)
    change = {"current_password": temporary, "new_password": PASSWORD}
    assert client.post("/auth/change-password", json=change, headers=headers).status_code == 204
    return user_id, headers


def check(response, status_code=200):
    assert response.status_code == status_code, response.text
    return response.json() if response.content else None


def test_full_project_lifecycle(client, admin):
    mia, as_mia = new_user(client, admin, "manager", "Mia")
    ann, as_ann = new_user(client, admin, "employee", "Ann", mia)

    # Admin creates the project and sets its budget
    project = check(client.post("/projects", headers=admin, json={
        "name": "Decommission 1000 servers", "manager_id": mia, "start_date": str(TODAY),
        "projected_end_date": str(TODAY + timedelta(days=90)), "allocated_hours": 2000, "budget": "50000",
    }), 201)
    pid = project["id"]
    estimate = check(client.get(f"/projects/{pid}/budget-estimate", headers=admin))
    assert estimate == {"project_id": pid, "estimated_cost": "0.00"}

    # The manager staffs it, plans milestones and starts work
    member = check(client.post(f"/projects/{pid}/members", headers=as_mia, json={"user_id": ann, "hours_per_week": 40}), 201)
    assert (member["employee_hours_per_week"], member["over_limit"]) == ("40.0", False)
    q1 = check(client.post(f"/projects/{pid}/milestones", headers=as_mia, json={
        "sequence": 1, "title": "Q1: 250 servers", "start_date": str(TODAY), "end_date": str(TODAY + timedelta(days=30))}), 201)
    task = check(client.post(f"/milestones/{q1['id']}/tasks", headers=as_mia, json={"title": "Unrack 250 servers"}), 201)
    check(client.post(f"/milestones/{q1['id']}/assignments", headers=as_mia, json={"user_id": ann}), 201)
    check(client.patch(f"/projects/{pid}", headers=as_mia, json={"status": "active"}))
    check(client.patch(f"/milestones/{q1['id']}", headers=as_mia, json={"status": "in_progress"}))
    check(client.post("/messages", headers=as_mia, json={"project_id": pid, "body": "Kickoff Monday"}), 201)

    # The employee sees their work, ticks off the task and logs hours
    assert check(client.get("/milestones/active", headers=as_ann))["id"] == q1["id"]
    assert [m["id"] for m in check(client.get("/milestones", params={"start": str(date.today())}, headers=as_ann))] \
        == [m["id"] for m in check(client.get(f"/projects/{project['id']}/milestones", headers=as_ann))
            if m["end_date"] >= str(date.today())]
    assert client.get("/milestones", params={"start": "2026-02-01", "end": "2026-01-01"}, headers=as_ann).status_code == 400
    assert check(client.patch(f"/milestones/tasks/{task['id']}", headers=as_ann, json={"is_done": True}))["done_by"] == ann
    logged = check(client.post("/time-entries", headers=as_ann, json={
        "project_id": pid, "milestone_id": q1["id"], "work_date": str(TODAY), "hours": "8"}), 201)
    assert logged["week_hours"] == "8.00"
    assert [m["body"] for m in check(client.get("/messages", headers=as_ann))] == ["Kickoff Monday"]
    home = check(client.get("/reports/home", headers=as_ann))
    assert (home["active_milestone_id"], home["project_ids"]) == (q1["id"], [pid])

    # Ticking off the last task doesn't complete the milestone; the manager does
    assert check(client.get(f"/milestones/{q1['id']}", headers=as_mia))["status"] == "in_progress"
    check(client.patch(f"/milestones/{q1['id']}", headers=as_ann, json={"status": "completed"}), 403)
    check(client.patch(f"/milestones/{q1['id']}", headers=as_mia, json={"status": "completed"}))

    # Reports answer the manager's questions
    [health] = check(client.get("/reports/projects", headers=as_mia))
    assert (health["completion_pct"], health["labor_cost"]) == ("100.0", "400.00")
    [deliverable] = check(client.get(f"/projects/{pid}/deliverables", headers=as_mia))
    assert (deliverable["status"], deliverable["tasks_done"], deliverable["assignees"]) == ("completed", 1, [ann])
    [budget] = check(client.get("/reports/budget", headers=as_mia))
    assert budget["budget_remaining"] == "49600.00"
    assert check(client.get("/reports/home", headers=as_mia))["active_projects"] == 1

    # The project stays open until the manager completes it, which archives it
    assert check(client.get(f"/projects/{pid}", headers=as_mia))["status"] == "active"
    completed = check(client.patch(f"/projects/{pid}", headers=as_mia, json={"status": "completed"}))
    assert (completed["archive_reason"], completed["archived_by"]) == ("completed", mia)
    check(client.get(f"/projects/{pid}", headers=as_mia), 404)
    assert [p["id"] for p in check(client.get("/projects?archived=true", headers=admin))] == [pid]

    # Everything above is in the audit log, attributed to whoever did it
    entries = check(client.get(f"/audit?entity=projects&entity_id={pid}", headers=admin))
    assert {e["actor_id"] for e in entries} == {"ADMIN9", mia}
    check(client.get("/audit", headers=as_mia), 403)


def openapi_operations():
    for path, operations in app.openapi()["paths"].items():
        for method in operations:
            yield method.upper(), path


@pytest.mark.parametrize("method, path", [op for op in openapi_operations() if op[1] not in PUBLIC_ROUTES])
def test_every_route_requires_login(client, method, path):
    url = re.sub(r"{(\w+)}", lambda m: "ABC123" if m.group(1) == "user_id" else "1", path)
    assert client.request(method, url).status_code == 401


def test_temporary_passwords_must_be_changed_first(client, admin):
    created = check(client.post("/users", headers=admin, json={
        "role": "manager", "first_name": "New", "last_name": "Hire", "email": "new@example.com", "job_title": "Manager"}), 201)
    headers = log_in(client, created["user"]["email"], created["temporary_password"])
    check(client.get("/projects", headers=headers), 403)
    check(client.get("/auth/me", headers=headers))


def test_employees_do_not_see_salaries(client, admin):
    mia, as_mia = new_user(client, admin, "manager", "Mia")
    ann, as_ann = new_user(client, admin, "employee", "Ann", mia)
    assert "salary" in check(client.get(f"/users/{ann}", headers=as_mia))
    for user in check(client.get("/users", headers=as_ann)):
        assert "salary" not in user
    assert "salary" not in check(client.get("/auth/me", headers=as_ann))


def test_employees_get_projects_without_budgets(client, admin):
    mia, as_mia = new_user(client, admin, "manager", "Mia")
    ann, as_ann = new_user(client, admin, "employee", "Ann", mia)
    pid = check(client.post("/projects", headers=admin, json={
        "name": "X", "manager_id": mia, "start_date": str(TODAY), "projected_end_date": str(TODAY),
        "allocated_hours": 1, "budget": "1000"}), 201)["id"]
    check(client.post(f"/projects/{pid}/members", headers=as_mia, json={"user_id": ann}), 201)
    assert "budget" not in check(client.get(f"/projects/{pid}", headers=as_ann))
    assert all("budget" not in p for p in check(client.get("/projects", headers=as_ann)))
    assert check(client.get(f"/projects/{pid}", headers=as_mia))["budget"] == "1000.00"


def test_users_edit_only_their_own_details(client, admin):
    mia, as_mia = new_user(client, admin, "manager", "Mia")
    updated = check(client.patch("/auth/me", headers=as_mia, json={"first_name": "Mira", "job_title": "CEO"}))
    assert (updated["first_name"], updated["job_title"]) == ("Mira", "Manager")  # job_title is ignored
    check(client.patch(f"/users/{mia}", headers=as_mia, json={"job_title": "CEO"}), 403)


def test_errors_use_the_right_status_codes(client, admin):
    mia, as_mia = new_user(client, admin, "manager", "Mia")
    check(client.get("/projects/999", headers=admin), 404)
    check(client.post("/projects", headers=as_mia, json={
        "name": "X", "manager_id": mia, "start_date": str(TODAY), "projected_end_date": str(TODAY),
        "allocated_hours": 1}), 403)
    check(client.post("/projects", headers=admin, json={"name": ""}), 422)
    pid = check(client.post("/projects", headers=admin, json={
        "name": "X", "manager_id": mia, "start_date": str(TODAY), "projected_end_date": str(TODAY),
        "allocated_hours": 1}), 201)["id"]
    check(client.delete(f"/projects/{pid}", headers=admin))
    assert check(client.delete(f"/projects/{pid}", headers=admin), 409) == {"detail": "Project is already archived"}
    check(client.post(f"/projects/{pid}/unarchive", headers=admin))
    check(client.post(f"/projects/{pid}/milestones", headers=as_mia, json={
        "sequence": 1, "title": "M", "start_date": str(TODAY), "end_date": str(TODAY - timedelta(days=1))}), 422)


def test_delete_routes_return_204(client, admin):
    mia, as_mia = new_user(client, admin, "manager", "Mia")
    ann, _ = new_user(client, admin, "employee", "Ann", mia)
    pid = check(client.post("/projects", headers=admin, json={
        "name": "X", "manager_id": mia, "start_date": str(TODAY), "projected_end_date": str(TODAY + timedelta(days=9)),
        "allocated_hours": 10}), 201)["id"]
    check(client.post(f"/projects/{pid}/members", headers=as_mia, json={"user_id": ann}), 201)
    milestone = check(client.post(f"/projects/{pid}/milestones", headers=as_mia, json={
        "sequence": 1, "title": "M", "start_date": str(TODAY), "end_date": str(TODAY)}), 201)
    task = check(client.post(f"/milestones/{milestone['id']}/tasks", headers=as_mia, json={"title": "T"}), 201)
    message = check(client.post("/messages", headers=as_mia, json={"project_id": pid, "body": "Hi"}), 201)

    assert client.delete(f"/milestones/tasks/{task['id']}", headers=as_mia).status_code == 204
    assert client.delete(f"/milestones/{milestone['id']}", headers=as_mia).status_code == 204
    assert client.delete(f"/messages/{message['id']}", headers=as_mia).status_code == 204
    assert client.delete(f"/projects/{pid}/members/{ann}", headers=as_mia).status_code == 204
    check(client.delete(f"/projects/{pid}/members/{ann}", headers=as_mia), 404)


def test_deleting_archives_and_admins_still_see_archived_projects(client, admin):
    mia, as_mia = new_user(client, admin, "manager", "Mia")
    project = {"manager_id": mia, "start_date": str(TODAY), "projected_end_date": str(TODAY), "allocated_hours": 1}
    kept = check(client.post("/projects", headers=admin, json={**project, "name": "Kept"}), 201)["id"]
    gone = check(client.post("/projects", headers=admin, json={**project, "name": "Gone"}), 201)["id"]

    check(client.delete(f"/projects/{gone}", headers=as_mia), 403)
    # Only completed projects can be archived as completed
    check(client.request("DELETE", f"/projects/{gone}", headers=admin, json={"reason": "completed"}), 409)
    deleted = check(client.delete(f"/projects/{gone}", headers=admin))  # no body: reason "deleted"
    assert (deleted["archived"], deleted["archive_reason"], deleted["archived_by"]) == (True, "deleted", "ADMIN9")

    listed = {p["id"]: p["archived"] for p in check(client.get("/projects", headers=admin))}
    assert listed == {kept: False, gone: True}
    assert [p["id"] for p in check(client.get("/projects?archived=false", headers=admin))] == [kept]
    assert [p["id"] for p in check(client.get("/projects", headers=as_mia))] == [kept]

    restored = check(client.post(f"/projects/{gone}/unarchive", headers=admin))
    assert (restored["archived"], restored["archive_reason"]) == (False, None)
