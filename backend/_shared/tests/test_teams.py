"""
Tests for teams: database rules, the team service, and the HTTP routes.

Each test runs in its own temporary schema (see the db fixture in conftest.py).
Run from the service folder: pytest
"""

from datetime import date, timedelta
from decimal import Decimal
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from psycopg import errors

from app import app
from database import get_db
from models.projects import ProjectCreate, ProjectMemberCreate
from models.teams import TeamCreate, TeamUpdate
from models.users import UserCreate, UserUpdate
from repositories.dashboard import DashboardRepository
from repositories.milestones import MilestoneRepository
from repositories.projects import ProjectRepository
from repositories.teams import TeamRepository
from repositories.users import UserRepository
from services.errors import ConflictError, InvalidRequestError, NotFoundError, PermissionDeniedError
from services.projects import ProjectService
from services.reports import ReportService
from services.security import hash_password
from services.teams import TeamService
from services.users import UserService

TODAY = date.today()


@pytest.fixture
def svc(db):
    users, projects, dashboard = UserRepository(db), ProjectRepository(db), DashboardRepository(db)
    project_service = ProjectService(projects, users, dashboard)
    teams = TeamService(TeamRepository(db), users, projects, project_service)
    return SimpleNamespace(
        users=UserService(users), projects=project_service, teams=teams, user_repo=users,
        reports=ReportService(dashboard, projects, MilestoneRepository(db), users, project_service, teams),
    )


@pytest.fixture
def org(svc):
    """An admin; managers Mia and Max; Ann and Ben report to Mia, Cal to Max."""
    admin = svc.user_repo.create({
        "id": "ADMIN9", "role": "admin", "first_name": "Ada", "last_name": "Admin", "email": "ada@example.com",
        "job_title": "Administrator", "password_hash": hash_password("a long password"),
        "must_change_password": False,
    })

    def create(role, first, manager=None):
        created = svc.users.create_user(admin, UserCreate(
            role=role, first_name=first, last_name="Test", email=f"{first.lower()}@example.com", job_title=role.title(),
            salary=Decimal("104000"), manager_id=manager["id"] if manager else None))
        return svc.user_repo.get(created.user.id)

    mia, max_ = create("manager", "Mia"), create("manager", "Max")
    org = SimpleNamespace(admin=admin, mia=mia, max=max_, ann=create("employee", "Ann", mia),
                          ben=create("employee", "Ben", mia), cal=create("employee", "Cal", max_))
    org.team = svc.teams.create_team(mia, TeamCreate(name="Data center crew"))
    org.project = svc.projects.create_project(admin, ProjectCreate(
        name="Decommission servers", manager_id=mia["id"], start_date=TODAY,
        projected_end_date=TODAY + timedelta(days=30), allocated_hours=500))
    return org


# Creating and seeing teams


def test_managers_create_teams_for_themselves(svc, org):
    assert (org.team.manager_id, org.team.member_count) == (org.mia["id"], 0)
    with pytest.raises(InvalidRequestError, match="for themselves"):
        svc.teams.create_team(org.mia, TeamCreate(name="Not mine", manager_id=org.max["id"]))
    with pytest.raises(PermissionDeniedError):
        svc.teams.create_team(org.ann, TeamCreate(name="Employees can't"))


def test_admins_create_teams_for_a_manager(svc, org):
    team = svc.teams.create_team(org.admin, TeamCreate(name="Night shift", manager_id=org.max["id"]))
    assert team.manager_id == org.max["id"]
    with pytest.raises(InvalidRequestError, match="active manager"):
        svc.teams.create_team(org.admin, TeamCreate(name="No manager"))


def test_team_names_are_unique_per_manager(svc, org):
    with pytest.raises(ConflictError, match="already has a team with that name"):
        svc.teams.create_team(org.mia, TeamCreate(name="DATA CENTER CREW"))
    assert svc.teams.create_team(org.max, TeamCreate(name="Data center crew")).manager_id == org.max["id"]


def test_teams_are_private_to_their_manager_and_admins(svc, org):
    svc.teams.create_team(org.max, TeamCreate(name="Max's team"))
    assert [t.name for t in svc.teams.list_teams(org.mia)] == ["Data center crew"]
    assert {t.name for t in svc.teams.list_teams(org.admin)} == {"Data center crew", "Max's team"}
    assert [t.name for t in svc.teams.list_teams(org.admin, manager_id=org.max["id"])] == ["Max's team"]
    with pytest.raises(NotFoundError):
        svc.teams.get_team(org.max, org.team.id)
    with pytest.raises(NotFoundError):
        svc.teams.update_team(org.max, org.team.id, TeamUpdate(name="Taken over"))
    assert svc.teams.update_team(org.admin, org.team.id, TeamUpdate(name="Renamed")).name == "Renamed"


def test_team_search_matches_names_within_the_managers_own_teams(svc, org):
    svc.teams.create_team(org.max, TeamCreate(name="Data hall B"))
    assert [t.name for t in svc.teams.list_teams(org.mia, q="data")] == ["Data center crew"]
    assert {t.name for t in svc.teams.list_teams(org.admin, q="DATA")} == {"Data center crew", "Data hall B"}
    assert svc.teams.list_teams(org.mia, q="hall") == []  # Max's team never shows up for Mia
    with pytest.raises(PermissionDeniedError):
        svc.teams.list_teams(org.ann)


# Members


def test_only_the_managers_direct_reports_can_join(svc, org):
    member = svc.teams.add_member(org.mia, org.team.id, org.ann["id"].lower())
    assert (member.user_id, member.first_name) == (org.ann["id"], "Ann")
    assert svc.teams.get_team(org.mia, org.team.id).member_count == 1
    with pytest.raises(InvalidRequestError, match="report to the team's manager"):
        svc.teams.add_member(org.mia, org.team.id, org.cal["id"])
    with pytest.raises(InvalidRequestError, match="active employees"):
        svc.teams.add_member(org.mia, org.team.id, org.max["id"])
    with pytest.raises(ConflictError, match="already on this team"):
        svc.teams.add_member(org.mia, org.team.id, org.ann["id"])


def test_the_database_also_refuses_other_managers_employees(db, org):
    with pytest.raises(errors.CheckViolation, match="does not report"):
        db.execute("INSERT INTO team_members (team_id, user_id) VALUES (%s, %s)", (org.team.id, org.cal["id"]))


def test_changing_an_employees_manager_removes_them_from_old_teams(svc, org):
    svc.teams.add_member(org.mia, org.team.id, org.ann["id"])
    svc.teams.add_member(org.mia, org.team.id, org.ben["id"])
    svc.users.update_user(org.admin, org.ann["id"], UserUpdate(manager_id=org.max["id"]))
    assert [m.user_id for m in svc.teams.list_members(org.mia, org.team.id)] == [org.ben["id"]]


def test_removing_members_and_deleting_teams(svc, org):
    svc.teams.add_member(org.mia, org.team.id, org.ann["id"])
    svc.teams.remove_member(org.mia, org.team.id, org.ann["id"])
    with pytest.raises(NotFoundError, match="not on this team"):
        svc.teams.remove_member(org.mia, org.team.id, org.ann["id"])
    svc.teams.delete_team(org.mia, org.team.id)
    with pytest.raises(NotFoundError):
        svc.teams.get_team(org.mia, org.team.id)


# Staffing projects and reports


def test_adding_a_team_to_a_project(svc, org):
    for employee in (org.ann, org.ben):
        svc.teams.add_member(org.mia, org.team.id, employee["id"])
    svc.projects.add_member(org.mia, org.project.id, ProjectMemberCreate(user_id=org.ben["id"], hours_per_week=10))
    svc.users.update_user(org.admin, org.ann["id"], UserUpdate(is_active=False))
    dee = svc.users.create_user(org.admin, UserCreate(
        role="employee", first_name="Dee", last_name="Test", email="dee@example.com", job_title="Engineer",
        salary=Decimal("90000"), manager_id=org.mia["id"])).user
    svc.teams.add_member(org.mia, org.team.id, dee.id)

    result = svc.teams.add_team_to_project(org.mia, org.project.id, org.team.id, Decimal(20))
    assert [(m.user_id, m.hours_per_week, m.over_limit) for m in result.added] == [(dee.id, 20, False)]
    assert {s.user_id: s.reason for s in result.skipped} == {
        org.ann["id"]: "Deactivated", org.ben["id"]: "Already on the project"}
    assert {m.user_id for m in svc.projects.list_members(org.mia, org.project.id)} == {org.ben["id"], dee.id}

    # Deleting the team leaves the project's members in place
    svc.teams.delete_team(org.mia, org.team.id)
    assert len(svc.projects.list_members(org.mia, org.project.id)) == 2


def test_teams_only_staff_projects_their_manager_runs(svc, org):
    max_project = svc.projects.create_project(org.admin, ProjectCreate(
        name="Max's", manager_id=org.max["id"], start_date=TODAY, projected_end_date=TODAY, allocated_hours=1))
    with pytest.raises(NotFoundError):
        svc.teams.add_team_to_project(org.mia, max_project.id, org.team.id, Decimal(10))
    with pytest.raises(NotFoundError):
        svc.teams.add_team_to_project(org.max, max_project.id, org.team.id, Decimal(10))


def test_allocation_reports_filter_by_team(svc, org):
    svc.teams.add_member(org.mia, org.team.id, org.ann["id"])
    svc.projects.add_member(org.mia, org.project.id, ProjectMemberCreate(user_id=org.ann["id"], hours_per_week=40))
    svc.projects.add_member(org.mia, org.project.id, ProjectMemberCreate(user_id=org.ben["id"], hours_per_week=40))
    other = svc.projects.create_project(org.admin, ProjectCreate(
        name="Other", manager_id=org.mia["id"], start_date=TODAY, projected_end_date=TODAY, allocated_hours=1))
    svc.projects.add_member(org.mia, other.id, ProjectMemberCreate(user_id=org.ben["id"], hours_per_week=10))

    assert {a.user_id for a in svc.reports.resource_allocation(org.mia)} == {org.ann["id"], org.ben["id"]}
    assert [a.user_id for a in svc.reports.resource_allocation(org.mia, team_id=org.team.id)] == [org.ann["id"]]
    assert [a.user_id for a in svc.reports.over_allocated(org.mia)] == [org.ben["id"]]
    assert svc.reports.over_allocated(org.mia, team_id=org.team.id) == []
    with pytest.raises(NotFoundError):
        svc.reports.resource_allocation(org.max, team_id=org.team.id)


# HTTP routes


def test_team_routes_end_to_end(db, svc, org):
    app.dependency_overrides[get_db] = lambda: db
    try:
        client = TestClient(app)
        svc.user_repo.set_password(org.mia["id"], hash_password("a long password"), must_change_password=False)  # log in as Mia
        token = client.post("/auth/token", data={"username": org.mia["email"], "password": "a long password"}).json()
        headers = {"Authorization": f"Bearer {token['access_token']}"}

        team = client.post("/teams", headers=headers, json={"name": "Racking"})
        assert team.status_code == 201
        team_id = team.json()["id"]
        assert client.post(f"/teams/{team_id}/members", headers=headers, json={"user_id": org.ann["id"]}).status_code == 201
        assert client.post(f"/teams/{team_id}/members", headers=headers,
                           json={"user_id": org.cal["id"]}).status_code == 400
        assert [m["user_id"] for m in client.get(f"/teams/{team_id}/members", headers=headers).json()] == [org.ann["id"]]
        assert [t["name"] for t in client.get("/teams", headers=headers, params={"q": "RACK"}).json()] == ["Racking"]

        staffed = client.post(f"/projects/{org.project.id}/teams", headers=headers,
                              json={"team_id": team_id, "hours_per_week": 25})
        assert staffed.status_code == 200
        assert [m["user_id"] for m in staffed.json()["added"]] == [org.ann["id"]]
        report = client.get(f"/reports/allocation?team_id={team_id}", headers=headers).json()
        assert [(a["user_id"], a["hours_per_week"]) for a in report] == [(org.ann["id"], "25.0")]

        assert client.delete(f"/teams/{team_id}/members/{org.ann['id']}", headers=headers).status_code == 204
        assert client.patch(f"/teams/{team_id}", headers=headers, json={"name": "Racking crew"}).json()["name"] == "Racking crew"
        assert client.delete(f"/teams/{team_id}", headers=headers).status_code == 204
        assert client.get(f"/teams/{team_id}", headers=headers).status_code == 404
    finally:
        app.dependency_overrides.clear()
