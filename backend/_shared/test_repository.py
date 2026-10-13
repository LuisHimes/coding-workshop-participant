"""
Tests for the repository layer against a real PostgreSQL.

Each test runs in its own temporary schema (see the db fixture in conftest.py).
Run from the service folder: pytest
"""

from datetime import date
from decimal import Decimal

import pytest

from repository.audit import AuditRepository
from repository.dashboard import DashboardRepository
from repository.messages import MessageRepository
from repository.milestones import MilestoneRepository
from repository.projects import ProjectRepository
from repository.time_entries import TimeEntryRepository
from repository.users import UserRepository


def new_user(db, role, manager_id=None, **values):
    return UserRepository(db).create({
        "role": role, "first_name": "Test", "last_name": role.title(),
        "email": f"{role}.{values.pop('suffix', '1')}@example.com", "password_hash": "hash",
        "job_title": role.title(), "manager_id": manager_id,
        "salary": Decimal("104000") if role == "employee" else None, **values,
    })


@pytest.fixture
def repos(db):
    return {
        "users": UserRepository(db), "projects": ProjectRepository(db), "milestones": MilestoneRepository(db),
        "time_entries": TimeEntryRepository(db), "messages": MessageRepository(db),
        "audit": AuditRepository(db), "dashboard": DashboardRepository(db),
    }


@pytest.fixture
def org(db):
    admin = new_user(db, "admin")
    manager = new_user(db, "manager")
    employee = new_user(db, "employee", manager["id"], first_name="Grace", last_name="Hopper")
    project = ProjectRepository(db).create({
        "name": "Decommission servers", "description": "Retire 1000 servers", "manager_id": manager["id"],
        "start_date": date(2026, 1, 1), "projected_end_date": date(2026, 1, 14),
        "allocated_hours": 1000, "budget": Decimal("10000"),
    })
    return {"admin": admin, "manager": manager, "employee": employee, "project": project}


# Users


def test_user_queries_never_return_the_password_hash(org, repos):
    users = repos["users"]
    employee = org["employee"]
    assert "password_hash" not in employee
    assert "password_hash" not in users.get(employee["id"])
    assert all("password_hash" not in u for u in users.find())
    assert users.get_credentials(employee["id"])["password_hash"] == "hash"


def test_list_users_filters(org, repos):
    users = repos["users"]
    manager_id = org["manager"]["id"]
    assert [u["id"] for u in users.find(role="employee")] == [org["employee"]["id"]]
    assert [u["id"] for u in users.find(manager_id=manager_id)] == [org["employee"]["id"]]
    assert [u["first_name"] for u in users.find(q="hopper")] == ["Grace"]

    users.update(org["employee"]["id"], {"is_active": False})
    assert users.find(role="employee") == []
    assert len(users.find(role="employee", include_inactive=True)) == 1


def test_set_password_clears_the_temporary_flag(org, repos):
    users = repos["users"]
    employee_id = org["employee"]["id"]
    assert org["employee"]["must_change_password"] is True
    assert users.set_password(employee_id, "permanent-hash", must_change_password=False)
    credentials = users.get_credentials(employee_id)
    assert (credentials["password_hash"], credentials["must_change_password"]) == ("permanent-hash", False)


def test_update_user_with_no_fields_returns_the_user(org, repos):
    users = repos["users"]
    assert users.update(org["employee"]["id"], {})["id"] == org["employee"]["id"]
    assert users.update("ZZZZZZ", {"job_title": "x"}) is None


# Projects


def test_archive_and_unarchive_project(org, repos):
    projects = repos["projects"]
    project_id = org["project"]["id"]
    archived = projects.archive(project_id, "deleted", org["admin"]["id"])
    assert (archived["archive_reason"], archived["archived_by"]) == ("deleted", org["admin"]["id"])
    assert projects.find() == []
    assert [p["id"] for p in projects.find(archived=True)] == [project_id]

    restored = projects.unarchive(project_id)
    assert restored["archived_at"] is None and restored["archived_by"] is None
    assert [p["id"] for p in projects.find()] == [project_id]


def test_list_projects_filters(org, repos):
    projects = repos["projects"]
    project_id, employee_id = org["project"]["id"], org["employee"]["id"]
    projects.add_member(project_id, employee_id, 20, org["manager"]["id"])
    assert [p["id"] for p in projects.find(manager_id=org["manager"]["id"])] == [project_id]
    assert [p["id"] for p in projects.find(member_id=employee_id)] == [project_id]
    assert [p["id"] for p in projects.find(q="1000 servers")] == [project_id]
    assert projects.find(status="active") == []


def test_project_members(org, repos):
    projects = repos["projects"]
    project_id, employee_id = org["project"]["id"], org["employee"]["id"]
    member = projects.add_member(project_id, employee_id, 20, org["manager"]["id"])
    assert member["hours_per_week"] == 20
    assert projects.is_member(project_id, employee_id)
    assert projects.update_member_hours(project_id, employee_id, 30)["hours_per_week"] == 30
    assert [m["user_id"] for m in projects.members_of(project_id)] == [employee_id]
    assert projects.remove_member(project_id, employee_id)
    assert not projects.is_member(project_id, employee_id)


# Milestones


def test_milestones_tasks_and_assignments(org, repos):
    projects = repos["projects"]
    milestones = repos["milestones"]
    project_id, employee_id = org["project"]["id"], org["employee"]["id"]
    projects.add_member(project_id, employee_id, 40, None)
    first = milestones.create(project_id, {
        "sequence": 1, "title": "Q1: 250 servers", "start_date": date(2026, 1, 1), "end_date": date(2026, 1, 7)})
    milestones.create(project_id, {
        "sequence": 2, "title": "Q2: 500 servers", "start_date": date(2026, 1, 8), "end_date": date(2026, 1, 14)})
    assert [m["sequence"] for m in milestones.for_project(project_id)] == [1, 2]

    task = milestones.create_task(first["id"], "Unrack 250 servers")
    assignment = milestones.assign(first["id"], employee_id)
    assert assignment["project_id"] == project_id
    assert milestones.get_active(employee_id) is None

    milestones.update(first["id"], {"status": "in_progress"})
    assert milestones.get_active(employee_id)["id"] == first["id"]

    done = milestones.update_task(task["id"], {"is_done": True, "done_by": employee_id})
    assert done["done_at"] is not None
    assert milestones.set_finished(first["id"], employee_id, True)["finished_at"] is not None
    assert milestones.get_active(employee_id) is None

    assert milestones.update(first["id"], {"status": "completed"})["completed_at"] is not None
    assert milestones.unassign(first["id"], employee_id)
    assert milestones.assignments_for(first["id"]) == []


def test_assigning_a_non_member_returns_an_error(org, repos):
    milestones = repos["milestones"]
    milestone = milestones.create(org["project"]["id"], {
        "sequence": 1, "title": "M1", "start_date": date(2026, 1, 1), "end_date": date(2026, 1, 7)})
    with pytest.raises(Exception, match="project_members"):
        milestones.assign(milestone["id"], org["employee"]["id"])


# Time entries, messages, audit and dashboard


def test_time_entries_filter_by_date_range(org, repos):
    time_entries = repos["time_entries"]
    employee_id, project_id = org["employee"]["id"], org["project"]["id"]
    for day in (5, 6, 12):
        time_entries.create(employee_id, {
            "project_id": project_id, "work_date": date(2026, 1, day), "hours": Decimal("8")})
    week = time_entries.find(user_id=employee_id, start=date(2026, 1, 5), end=date(2026, 1, 11))
    assert [e["work_date"].day for e in week] == [6, 5]
    entry = week[0]
    assert time_entries.update(entry["id"], {"hours": Decimal("7.5")})["hours"] == Decimal("7.5")
    assert time_entries.delete(entry["id"])
    assert len(time_entries.find(project_id=project_id)) == 2


def test_messages_show_global_and_own_project_posts(org, repos):
    projects = repos["projects"]
    messages = repos["messages"]
    manager_id, project_id = org["manager"]["id"], org["project"]["id"]
    other = projects.create({
        "name": "Other", "manager_id": manager_id, "start_date": date(2026, 1, 1),
        "projected_end_date": date(2026, 2, 1), "allocated_hours": 10})
    messages.create(org["admin"]["id"], "Welcome, everyone")
    messages.create(manager_id, "Kickoff Monday", project_id)
    messages.create(manager_id, "Not for you", other["id"])
    assert {m["body"] for m in messages.recent([project_id])} == {"Welcome, everyone", "Kickoff Monday"}
    assert len(messages.recent()) == 3
    assert len(messages.recent(limit=1)) == 1


def test_audit_entries_filter_by_entity_and_actor(org, repos):
    projects = repos["projects"]
    audit = repos["audit"]
    audit.set_actor(org["admin"]["id"])
    projects.update(org["project"]["id"], {"budget": Decimal("12000")})
    audit.record_event("LOGIN", "users", org["admin"]["id"])
    entries = audit.find(entity="projects", entity_id=str(org["project"]["id"]))
    assert entries[0]["changes"]["budget"] == {"old": 10000.00, "new": 12000.00}
    assert [e["action"] for e in audit.find(actor_id=org["admin"]["id"])] == ["LOGIN", "UPDATE"]


def test_dashboard_reports(org, repos):
    projects = repos["projects"]
    time_entries = repos["time_entries"]
    dashboard = repos["dashboard"]
    employee_id, project_id = org["employee"]["id"], org["project"]["id"]
    projects.add_member(project_id, employee_id, 40, None)
    time_entries.create(employee_id, {
        "project_id": project_id, "work_date": date(2026, 1, 5), "hours": Decimal("10")})

    [report] = dashboard.project_status(manager_id=org["manager"]["id"])
    assert (report["project_id"], report["labor_cost"]) == (project_id, Decimal("500.00"))
    assert dashboard.hours_in_week(employee_id, date(2026, 1, 7)) == 10  # same Monday-to-Sunday week
    assert dashboard.employee_allocation(employee_id)["hours_per_week"] == 40

    projects.archive(project_id, "deleted", org["admin"]["id"])
    assert dashboard.project_status() == []
    assert len(dashboard.project_status(include_archived=True)) == 1
