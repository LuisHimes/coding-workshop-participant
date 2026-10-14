"""
Tests for milestone templates and adding several milestones at once: database
rules, the services, and the HTTP routes.

Each test runs in its own temporary schema (see the db fixture in conftest.py).
Run from the service folder: pytest
"""

from datetime import date, timedelta
from decimal import Decimal
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from psycopg import errors
from pydantic import ValidationError

from app import app
from database import get_db
from models.milestone_templates import (
    MilestoneBatchCreate, MilestoneTemplateCreate, MilestoneTemplateUpdate, PlannedMilestone,
)
from models.milestones import MilestoneCreate, MilestoneUpdate
from models.projects import ProjectCreate
from models.users import UserCreate, UserUpdate
from repository.dashboard import DashboardRepository
from repository.milestone_templates import MilestoneTemplateRepository
from repository.milestones import MilestoneRepository
from repository.projects import ProjectRepository
from repository.users import UserRepository
from service.errors import ConflictError, InvalidRequestError, NotFoundError, PermissionDeniedError
from service.milestone_templates import MilestoneTemplateService
from service.milestones import MilestoneService
from service.projects import ProjectService
from service.security import hash_password
from service.users import UserService

TODAY = date.today()
PHASES = [{"title": "Kickoff", "duration_days": 5}, {"title": "Build", "description": "Write the code"}, {"title": "Launch"}]


@pytest.fixture
def svc(db):
    users, projects = UserRepository(db), ProjectRepository(db)
    project_service = ProjectService(projects, users, DashboardRepository(db))
    return SimpleNamespace(
        users=UserService(users), user_repo=users, projects=project_service,
        templates=MilestoneTemplateService(MilestoneTemplateRepository(db), users),
        milestones=MilestoneService(MilestoneRepository(db), projects, project_service),
    )


@pytest.fixture
def org(svc):
    """An admin; managers Mia and Max; Ann reports to Mia; Mia runs one project."""
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
    org = SimpleNamespace(admin=admin, mia=mia, max=max_, ann=create("employee", "Ann", mia))
    org.template = svc.templates.create_template(mia, MilestoneTemplateCreate(name="Software release", milestones=PHASES))
    org.project = svc.projects.create_project(admin, ProjectCreate(
        name="Customer portal", manager_id=mia["id"], start_date=TODAY,
        projected_end_date=TODAY + timedelta(days=90), allocated_hours=500))
    return org


def planned(title, start, days):
    return PlannedMilestone(title=title, start_date=TODAY + timedelta(days=start),
                            end_date=TODAY + timedelta(days=start + days - 1))


# Templates


def test_managers_create_templates_for_themselves_with_milestones_in_order(svc, org):
    template = org.template
    assert (template.manager_id, template.name) == (org.mia["id"], "Software release")
    assert [(m.sequence, m.title, m.description, m.duration_days) for m in template.milestones] == [
        (1, "Kickoff", None, 5), (2, "Build", "Write the code", None), (3, "Launch", None, None)]
    with pytest.raises(InvalidRequestError, match="for themselves"):
        svc.templates.create_template(org.mia, MilestoneTemplateCreate(name="Not mine", manager_id=org.max["id"],
                                                                        milestones=PHASES))
    with pytest.raises(PermissionDeniedError):
        svc.templates.create_template(org.ann, MilestoneTemplateCreate(name="Employees can't", milestones=PHASES))


def test_admins_create_templates_for_an_active_manager(svc, org):
    template = svc.templates.create_template(org.admin, MilestoneTemplateCreate(
        name="Hardware refresh", manager_id=org.max["id"].lower(), milestones=PHASES[:1]))
    assert template.manager_id == org.max["id"]
    with pytest.raises(InvalidRequestError):
        svc.templates.create_template(org.admin, MilestoneTemplateCreate(name="No manager", milestones=PHASES))
    with pytest.raises(InvalidRequestError):
        svc.templates.create_template(org.admin, MilestoneTemplateCreate(name="Not a manager", manager_id=org.ann["id"],
                                                                          milestones=PHASES))
    svc.users.update_user(org.admin, org.max["id"], UserUpdate(is_active=False))
    with pytest.raises(InvalidRequestError):
        svc.templates.create_template(org.admin, MilestoneTemplateCreate(name="Gone", manager_id=org.max["id"],
                                                                          milestones=PHASES))


def test_template_names_are_unique_per_manager_ignoring_case(svc, org):
    with pytest.raises(ConflictError, match="already has a milestone template with that name"):
        svc.templates.create_template(org.mia, MilestoneTemplateCreate(name="SOFTWARE RELEASE", milestones=PHASES))
    # Another manager can use the same name
    svc.templates.create_template(org.max, MilestoneTemplateCreate(name="Software release", milestones=PHASES))


def test_templates_need_one_to_fifty_named_milestones_with_sensible_lengths():
    with pytest.raises(ValidationError):
        MilestoneTemplateCreate(name="Empty", milestones=[])
    with pytest.raises(ValidationError):
        MilestoneTemplateCreate(name="Too many", milestones=[{"title": f"Step {i}"} for i in range(51)])
    with pytest.raises(ValidationError):
        MilestoneTemplateCreate(name="Blank", milestones=[{"title": ""}])
    for days in (0, 3651):
        with pytest.raises(ValidationError):
            MilestoneTemplateCreate(name="Length", milestones=[{"title": "Step", "duration_days": days}])
    assert MilestoneTemplateCreate(name="Edges", milestones=[{"title": "A", "duration_days": 1},
                                                             {"title": "B", "duration_days": 3650}])


def test_the_database_also_refuses_templates_for_non_managers(db, org):
    with pytest.raises(errors.ForeignKeyViolation):
        db.execute("INSERT INTO milestone_templates (name, manager_id) VALUES ('Sneaky', %s)", (org.ann["id"],))


def test_templates_are_private_to_their_manager_and_admins(svc, org):
    max_template = svc.templates.create_template(org.max, MilestoneTemplateCreate(name="Network work", milestones=PHASES))
    assert [t.name for t in svc.templates.list_templates(org.mia)] == ["Software release"]
    # Managers can't widen their view by asking for another manager
    assert [t.name for t in svc.templates.list_templates(org.mia, manager_id=org.max["id"])] == ["Software release"]
    assert [t.name for t in svc.templates.list_templates(org.admin)] == ["Network work", "Software release"]
    assert [t.name for t in svc.templates.list_templates(org.admin, manager_id=org.max["id"].lower())] == ["Network work"]
    assert [t.name for t in svc.templates.list_templates(org.mia, q="RELEASE")] == ["Software release"]
    assert svc.templates.list_templates(org.mia, q="nothing like it") == []
    assert svc.templates.get_template(org.admin, max_template.id).name == "Network work"
    with pytest.raises(NotFoundError):
        svc.templates.get_template(org.mia, max_template.id)
    with pytest.raises(NotFoundError):
        svc.templates.get_template(org.mia, 999999)
    with pytest.raises(PermissionDeniedError):
        svc.templates.list_templates(org.ann)


def test_editing_a_template_renames_it_and_replaces_its_milestones(svc, org):
    renamed = svc.templates.update_template(org.mia, org.template.id, MilestoneTemplateUpdate(name="Release v2"))
    assert (renamed.name, len(renamed.milestones)) == ("Release v2", 3)  # milestones left alone
    replaced = svc.templates.update_template(org.mia, org.template.id, MilestoneTemplateUpdate(
        description="Our usual plan", milestones=[{"title": "Design", "duration_days": 10}, {"title": "Ship"}]))
    assert replaced.description == "Our usual plan"
    assert [(m.sequence, m.title, m.duration_days) for m in replaced.milestones] == [(1, "Design", 10), (2, "Ship", None)]
    with pytest.raises(ValidationError):
        MilestoneTemplateUpdate(milestones=[])
    with pytest.raises(NotFoundError):
        svc.templates.update_template(org.max, org.template.id, MilestoneTemplateUpdate(name="Taken over"))


def test_deleting_a_template_keeps_milestones_already_added_from_it(svc, org):
    svc.milestones.create_milestones(org.mia, org.project.id, MilestoneBatchCreate(milestones=[planned("Kickoff", 0, 5)]))
    with pytest.raises(NotFoundError):
        svc.templates.delete_template(org.max, org.template.id)
    svc.templates.delete_template(org.admin, org.template.id)
    assert svc.templates.list_templates(org.mia) == []
    assert [m.title for m in svc.milestones.list_milestones(org.mia, org.project.id)] == ["Kickoff"]


# Adding several milestones at once


def test_planned_milestones_are_added_after_existing_ones_in_order(svc, org):
    svc.milestones.create_milestone(org.mia, org.project.id, MilestoneCreate(
        sequence=1, title="Discovery", start_date=TODAY, end_date=TODAY + timedelta(days=4)))
    created = svc.milestones.create_milestones(org.mia, org.project.id, MilestoneBatchCreate(milestones=[
        planned("Kickoff", 5, 5), planned("Build", 10, 30), planned("Launch", 40, 1)]))
    assert [(m.sequence, m.title, m.status) for m in created] == [
        (2, "Kickoff", "not_started"), (3, "Build", "not_started"), (4, "Launch", "not_started")]
    assert created[2].start_date == created[2].end_date  # a one-day milestone
    # They run in sequence like any other milestones
    with pytest.raises(ConflictError, match="previous milestones"):
        svc.milestones.update_milestone(org.mia, created[0].id, MilestoneUpdate(status="in_progress"))


def test_a_project_without_milestones_starts_at_one(svc, org):
    created = svc.milestones.create_milestones(org.admin, org.project.id, MilestoneBatchCreate(milestones=[planned("Kickoff", 0, 5)]))
    assert created[0].sequence == 1


def test_planned_milestones_need_valid_dates_and_one_to_fifty_entries():
    with pytest.raises(ValidationError, match='"Build": end_date must be on or after start_date'):
        PlannedMilestone(title="Build", start_date=TODAY, end_date=TODAY - timedelta(days=1))
    with pytest.raises(ValidationError):
        MilestoneBatchCreate(milestones=[])
    with pytest.raises(ValidationError):
        MilestoneBatchCreate(milestones=[planned(f"Step {i}", i, 1) for i in range(51)])


def test_only_the_projects_manager_or_an_admin_adds_milestones_to_open_projects(svc, org):
    batch = MilestoneBatchCreate(milestones=[planned("Kickoff", 0, 5)])
    with pytest.raises(NotFoundError):
        svc.milestones.create_milestones(org.max, org.project.id, batch)
    with pytest.raises(NotFoundError):
        svc.milestones.create_milestones(org.ann, org.project.id, batch)
    svc.projects.archive_project(org.admin, org.project.id, "deleted")
    with pytest.raises(ConflictError, match="Archived projects"):
        svc.milestones.create_milestones(org.admin, org.project.id, batch)


def test_adding_milestones_is_all_or_nothing(svc, org, monkeypatch):
    real_create = svc.milestones.milestones.create
    calls = []

    def fail_on_second(project_id, values):
        calls.append(values["title"])
        if len(calls) == 2:
            raise errors.CheckViolation("simulated failure")
        return real_create(project_id, values)

    monkeypatch.setattr(svc.milestones.milestones, "create", fail_on_second)
    with pytest.raises(ConflictError):
        svc.milestones.create_milestones(org.mia, org.project.id, MilestoneBatchCreate(milestones=[
            planned("Kickoff", 0, 5), planned("Build", 5, 10)]))
    assert calls == ["Kickoff", "Build"]
    assert svc.milestones.list_milestones(org.mia, org.project.id) == []  # Kickoff was rolled back


# HTTP


def test_template_and_batch_routes_end_to_end(db, svc, org):
    app.dependency_overrides[get_db] = lambda: db
    try:
        client = TestClient(app)
        for person in (org.mia, org.ann):
            svc.user_repo.set_password(person["id"], hash_password("a long password"), must_change_password=False)

        def headers_for(person):
            token = client.post("/auth/token", data={"username": person["email"], "password": "a long password"}).json()
            return {"Authorization": f"Bearer {token['access_token']}"}

        mia, ann = headers_for(org.mia), headers_for(org.ann)
        created = client.post("/milestones/templates", headers=mia, json={
            "name": "Office move", "milestones": [{"title": "Plan", "duration_days": 10}, {"title": "Move"}]})
        assert created.status_code == 201
        template_id = created.json()["id"]
        assert [t["name"] for t in client.get("/milestones/templates", headers=mia).json()] == ["Office move", "Software release"]
        assert client.get(f"/milestones/templates/{template_id}", headers=mia).json()["milestones"][0]["duration_days"] == 10
        assert client.patch(f"/milestones/templates/{template_id}", headers=mia,
                            json={"name": "Office relocation"}).json()["name"] == "Office relocation"
        assert client.post("/milestones/templates", headers=mia, json={"name": "Empty", "milestones": []}).status_code == 422
        assert client.get("/milestones/templates", headers=ann).status_code == 403

        batch = client.post(f"/projects/{org.project.id}/milestones/batch", headers=mia, json={"milestones": [
            {"title": "Plan", "start_date": str(TODAY), "end_date": str(TODAY + timedelta(days=9))},
            {"title": "Move", "start_date": str(TODAY + timedelta(days=10)), "end_date": str(TODAY + timedelta(days=10))},
        ]})
        assert batch.status_code == 201
        assert [(m["sequence"], m["title"]) for m in batch.json()] == [(1, "Plan"), (2, "Move")]
        reversed_dates = client.post(f"/projects/{org.project.id}/milestones/batch", headers=mia, json={"milestones": [
            {"title": "Oops", "start_date": str(TODAY), "end_date": str(TODAY - timedelta(days=1))}]})
        assert reversed_dates.status_code == 422
        # Ann isn't on the project, so to her it doesn't exist
        assert client.post(f"/projects/{org.project.id}/milestones/batch", headers=ann, json={"milestones": [
            {"title": "Mine", "start_date": str(TODAY), "end_date": str(TODAY)}]}).status_code == 404

        # A milestone's own routes still work alongside /milestones/templates
        assert client.get(f"/milestones/{batch.json()[0]['id']}", headers=mia).json()["title"] == "Plan"
        assert client.delete(f"/milestones/templates/{template_id}", headers=mia).status_code == 204
        assert client.get(f"/milestones/templates/{template_id}", headers=mia).status_code == 404
    finally:
        app.dependency_overrides.clear()
