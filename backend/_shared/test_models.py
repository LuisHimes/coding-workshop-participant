"""
Tests for the models against a real PostgreSQL.

Each test runs in its own temporary schema (see the db fixture in conftest.py).
Run from the service folder: pytest
"""

import uuid
from datetime import date
from decimal import Decimal

import pytest
from psycopg import errors
from pydantic import ValidationError

from repository.audit import AuditRepository
from models.projects import ProjectCreate, ProjectMemberCreate, ProjectMemberUpdate
from models.teams import TeamProjectAssignment
from models.users import UserCreate


def make_user(db, role, manager_id=None, **fields):
    values = {
        "role": role,
        "first_name": "Test",
        "last_name": role.title(),
        "email": f"{uuid.uuid4().hex[:8]}@example.com",
        "password_hash": "hash",
        "job_title": role.title(),
        "salary": Decimal("104000") if role == "employee" else None,
        "manager_id": manager_id,
        **fields,
    }
    columns = ", ".join(values)
    placeholders = ", ".join(["%s"] * len(values))
    return db.execute(
        f"INSERT INTO users ({columns}) VALUES ({placeholders}) RETURNING id", list(values.values())
    ).fetchone()["id"]


def make_project(db, manager_id, **fields):
    values = {
        "name": "Decommission servers",
        "manager_id": manager_id,
        "start_date": date(2026, 1, 1),
        "projected_end_date": date(2026, 1, 14),
        "allocated_hours": 1000,
        "budget": Decimal("10000"),
        **fields,
    }
    columns = ", ".join(values)
    placeholders = ", ".join(["%s"] * len(values))
    return db.execute(
        f"INSERT INTO projects ({columns}) VALUES ({placeholders}) RETURNING id", list(values.values())
    ).fetchone()["id"]


def add_member(db, project_id, user_id, hours_per_week=40):
    db.execute(
        "INSERT INTO project_members (project_id, user_id, hours_per_week) VALUES (%s, %s, %s)",
        (project_id, user_id, hours_per_week),
    )


def add_milestone(db, project_id, sequence, title=None):
    return db.execute(
        "INSERT INTO milestones (project_id, sequence, title, start_date, end_date) "
        "VALUES (%s, %s, %s, '2026-01-01', '2026-01-07') RETURNING id",
        (project_id, sequence, title or f"Milestone {sequence}"),
    ).fetchone()["id"]


def assign(db, milestone_id, project_id, user_id):
    db.execute(
        "INSERT INTO milestone_assignments (milestone_id, project_id, user_id) VALUES (%s, %s, %s)",
        (milestone_id, project_id, user_id),
    )


def set_milestone_status(db, milestone_id, status):
    db.execute("UPDATE milestones SET status = %s WHERE id = %s", (status, milestone_id))


@pytest.fixture
def team(db):
    """An admin, a manager, and two employees reporting to the manager."""
    manager = make_user(db, "manager")
    return {
        "admin": make_user(db, "admin"),
        "manager": manager,
        "employee": make_user(db, "employee", manager_id=manager),
        "employee2": make_user(db, "employee", manager_id=manager),
    }


# Users


def test_user_id_is_generated_as_six_characters(db, team):
    assert all(len(user_id) == 6 and user_id.isalnum() and user_id.isupper() for user_id in team.values())


def test_user_id_must_be_six_uppercase_characters(db):
    with pytest.raises(errors.CheckViolation):
        make_user(db, "admin", id="abc")


def test_employee_requires_manager_and_salary(db, team):
    with pytest.raises(errors.CheckViolation):
        make_user(db, "employee")
    with pytest.raises(errors.CheckViolation):
        make_user(db, "employee", manager_id=team["manager"], salary=None)


def test_employee_manager_must_have_manager_role(db, team):
    with pytest.raises(errors.ForeignKeyViolation):
        make_user(db, "employee", manager_id=team["admin"])


def test_manager_with_employees_cannot_change_role(db, team):
    with pytest.raises(errors.ForeignKeyViolation):
        db.execute("UPDATE users SET role = 'admin' WHERE id = %s", (team["manager"],))


def test_email_is_unique_ignoring_case(db):
    make_user(db, "admin", email="Ada@Example.com")
    with pytest.raises(errors.UniqueViolation):
        make_user(db, "admin", email="ada@example.com")


def test_user_create_schema_requires_manager_for_employees():
    with pytest.raises(ValidationError):
        UserCreate(role="employee", first_name="A", last_name="B", email="a@b.co",
                   job_title="Engineer", salary=Decimal("1"), temporary_password="temporary1")


@pytest.mark.parametrize("role", ["manager", "admin"])
def test_user_create_schema_gives_managers_only_to_employees(role):
    with pytest.raises(ValidationError, match="only employees can be assigned a manager"):
        UserCreate(role=role, first_name="A", last_name="B", email="a@b.co", job_title="Lead", manager_id="ABC123")
    assert UserCreate(role=role, first_name="A", last_name="B", email="a@b.co", job_title="Lead").manager_id is None


# Projects


def test_project_manager_must_have_manager_role(db, team):
    with pytest.raises(errors.ForeignKeyViolation):
        make_project(db, team["admin"])


def test_project_members_must_be_employees(db, team):
    project = make_project(db, team["manager"])
    with pytest.raises(errors.ForeignKeyViolation):
        add_member(db, project, team["manager"])


def test_project_end_date_cannot_precede_start(db, team):
    with pytest.raises(errors.CheckViolation):
        make_project(db, team["manager"], projected_end_date=date(2025, 12, 31))


def test_archiving_requires_a_valid_reason(db, team):
    project = make_project(db, team["manager"])
    with pytest.raises(errors.CheckViolation):
        db.execute("UPDATE projects SET archived_at = now() WHERE id = %s", (project,))
    with pytest.raises(errors.CheckViolation):
        db.execute("UPDATE projects SET archived_at = now(), archive_reason = 'completed' WHERE id = %s",
                   (project,))
    db.execute("UPDATE projects SET archived_at = now(), archive_reason = 'deleted', archived_by = %s "
               "WHERE id = %s", (team["admin"], project))


def test_project_completes_only_when_all_milestones_complete(db, team):
    project = make_project(db, team["manager"])
    complete = "UPDATE projects SET status = 'completed' WHERE id = %s"
    with pytest.raises(errors.CheckViolation, match="milestones"):
        db.execute(complete, (project,))

    milestone = add_milestone(db, project, 1)
    with pytest.raises(errors.CheckViolation, match="milestones"):
        db.execute(complete, (project,))

    set_milestone_status(db, milestone, "completed")
    db.execute(complete, (project,))
    db.execute("UPDATE projects SET archived_at = now(), archive_reason = 'completed' "
               "WHERE id = %s", (project,))


def test_project_create_schema_allows_one_day_projects_but_not_reversed_dates():
    fields = {"name": "P", "manager_id": "ABC123", "allocated_hours": 1}
    assert ProjectCreate(**fields, start_date=date(2026, 3, 1), projected_end_date=date(2026, 3, 1))
    with pytest.raises(ValidationError, match="projected_end_date must be on or after start_date"):
        ProjectCreate(**fields, start_date=date(2026, 3, 2), projected_end_date=date(2026, 3, 1))


def test_member_schema_caps_one_project_at_a_full_week():
    assert ProjectMemberCreate(user_id="ABC123").hours_per_week == 40  # defaults to full time
    assert ProjectMemberCreate(user_id="ABC123", hours_per_week=Decimal("40")).hours_per_week == 40
    for hours in (Decimal("40.25"), Decimal("0")):
        with pytest.raises(ValidationError):
            ProjectMemberCreate(user_id="ABC123", hours_per_week=hours)



@pytest.mark.parametrize("schema", [
    lambda hours: ProjectMemberCreate(user_id="ABC123", hours_per_week=hours),
    lambda hours: ProjectMemberUpdate(hours_per_week=hours),
    lambda hours: TeamProjectAssignment(team_id=1, hours_per_week=hours),
])
def test_planned_hours_allow_one_decimal_place_like_the_column(schema):
    # hours_per_week is NUMERIC(4, 1): 10.25 would be silently stored as 10.3
    assert schema(Decimal("10.5")).hours_per_week == Decimal("10.5")
    with pytest.raises(ValidationError, match="decimal place"):
        schema(Decimal("10.25"))

# Milestones


def test_milestones_run_in_sequence(db, team):
    project = make_project(db, team["manager"])
    first = add_milestone(db, project, 1)
    second = add_milestone(db, project, 2)
    with pytest.raises(errors.CheckViolation, match="previous milestones"):
        set_milestone_status(db, second, "in_progress")
    set_milestone_status(db, first, "completed")
    set_milestone_status(db, second, "in_progress")


def test_milestone_completes_only_when_all_tasks_are_done(db, team):
    project = make_project(db, team["manager"])
    milestone = add_milestone(db, project, 1)
    task = db.execute("INSERT INTO milestone_tasks (milestone_id, title) VALUES (%s, '250 servers') "
                      "RETURNING id", (milestone,)).fetchone()["id"]
    with pytest.raises(errors.CheckViolation, match="tasks"):
        set_milestone_status(db, milestone, "completed")

    db.execute("UPDATE milestone_tasks SET is_done = true WHERE id = %s", (task,))
    set_milestone_status(db, milestone, "completed")
    row = db.execute("SELECT completed_at FROM milestones WHERE id = %s", (milestone,)).fetchone()
    assert row["completed_at"] is not None

    # Tasks of a completed milestone can't be reopened or added
    with pytest.raises(errors.CheckViolation, match="Reopen"):
        db.execute("UPDATE milestone_tasks SET is_done = false WHERE id = %s", (task,))
    with pytest.raises(errors.CheckViolation, match="Reopen"):
        db.execute("INSERT INTO milestone_tasks (milestone_id, title) VALUES (%s, 'late')", (milestone,))


def test_completed_milestone_cannot_reopen_after_next_started(db, team):
    project = make_project(db, team["manager"])
    first = add_milestone(db, project, 1)
    second = add_milestone(db, project, 2)
    set_milestone_status(db, first, "completed")
    set_milestone_status(db, second, "in_progress")
    with pytest.raises(errors.CheckViolation, match="reopened"):
        set_milestone_status(db, first, "in_progress")


def test_milestones_locked_once_project_completed(db, team):
    project = make_project(db, team["manager"])
    milestone = add_milestone(db, project, 1)
    set_milestone_status(db, milestone, "completed")
    db.execute("UPDATE projects SET status = 'completed' WHERE id = %s", (project,))
    with pytest.raises(errors.CheckViolation, match="completed project"):
        set_milestone_status(db, milestone, "in_progress")


def test_milestone_assignees_must_be_project_members(db, team):
    project = make_project(db, team["manager"])
    milestone = add_milestone(db, project, 1)
    with pytest.raises(errors.ForeignKeyViolation):
        assign(db, milestone, project, team["employee"])


def test_employee_has_one_active_milestone_when_assigned(db, team):
    employee = team["employee"]
    project_a = make_project(db, team["manager"], name="A")
    project_b = make_project(db, team["manager"], name="B")
    add_member(db, project_a, employee, 20)
    add_member(db, project_b, employee, 20)
    milestone_a = add_milestone(db, project_a, 1)
    milestone_b = add_milestone(db, project_b, 1)
    set_milestone_status(db, milestone_a, "in_progress")
    set_milestone_status(db, milestone_b, "in_progress")

    assign(db, milestone_a, project_a, employee)
    with pytest.raises(errors.CheckViolation, match="active milestone"):
        assign(db, milestone_b, project_b, employee)


def test_employee_has_one_active_milestone_when_started(db, team):
    employee = team["employee"]
    project_a = make_project(db, team["manager"], name="A")
    project_b = make_project(db, team["manager"], name="B")
    add_member(db, project_a, employee, 20)
    add_member(db, project_b, employee, 20)
    milestone_a = add_milestone(db, project_a, 1)
    milestone_b = add_milestone(db, project_b, 1)
    assign(db, milestone_a, project_a, employee)
    assign(db, milestone_b, project_b, employee)

    set_milestone_status(db, milestone_a, "in_progress")
    with pytest.raises(errors.CheckViolation, match="active milestone"):
        set_milestone_status(db, milestone_b, "in_progress")


def test_archived_projects_do_not_hold_active_milestones(db, team):
    employee = team["employee"]
    project_a = make_project(db, team["manager"], name="A")
    project_b = make_project(db, team["manager"], name="B")
    add_member(db, project_a, employee, 20)
    add_member(db, project_b, employee, 20)
    milestone_a = add_milestone(db, project_a, 1)
    milestone_b = add_milestone(db, project_b, 1)
    assign(db, milestone_a, project_a, employee)
    assign(db, milestone_b, project_b, employee)
    set_milestone_status(db, milestone_a, "in_progress")

    # Archiving project A frees the employee to start project B's milestone
    db.execute("UPDATE projects SET archived_at = now(), archive_reason = 'deleted' WHERE id = %s",
               (project_a,))
    set_milestone_status(db, milestone_b, "in_progress")

    # ...so A can't be unarchived while it would give them two active milestones
    with pytest.raises(errors.CheckViolation, match="unarchived"):
        db.execute("UPDATE projects SET archived_at = NULL, archive_reason = NULL WHERE id = %s",
                   (project_a,))


def two_projects_with_milestones(db, team):
    """The employee is a member of projects A and B, each with one milestone."""
    employee = team["employee"]
    project_a = make_project(db, team["manager"], name="A")
    project_b = make_project(db, team["manager"], name="B")
    add_member(db, project_a, employee, 20)
    add_member(db, project_b, employee, 20)
    return employee, (project_a, add_milestone(db, project_a, 1)), (project_b, add_milestone(db, project_b, 1))


def set_finished(db, milestone_id, user_id, finished):
    db.execute(
        f"UPDATE milestone_assignments SET finished_at = {'now()' if finished else 'NULL'} "
        "WHERE milestone_id = %s AND user_id = %s",
        (milestone_id, user_id),
    )


def test_finishing_their_part_frees_the_employee(db, team):
    employee, (project_a, milestone_a), (project_b, milestone_b) = two_projects_with_milestones(db, team)
    assign(db, milestone_a, project_a, employee)
    set_milestone_status(db, milestone_a, "in_progress")
    set_milestone_status(db, milestone_b, "in_progress")
    with pytest.raises(errors.CheckViolation, match="active milestone"):
        assign(db, milestone_b, project_b, employee)

    # Milestone A is still in progress for teammates, but this employee is done with it
    set_finished(db, milestone_a, employee, True)
    assign(db, milestone_b, project_b, employee)

    # ...and can't be put back on A while B is active
    with pytest.raises(errors.CheckViolation, match="active milestone"):
        set_finished(db, milestone_a, employee, False)


def test_completing_the_milestone_frees_its_assignees(db, team):
    employee, (project_a, milestone_a), (project_b, milestone_b) = two_projects_with_milestones(db, team)
    assign(db, milestone_a, project_a, employee)
    assign(db, milestone_b, project_b, employee)
    set_milestone_status(db, milestone_a, "in_progress")
    with pytest.raises(errors.CheckViolation, match="active milestone"):
        set_milestone_status(db, milestone_b, "in_progress")

    set_milestone_status(db, milestone_a, "completed")
    set_milestone_status(db, milestone_b, "in_progress")


def test_employee_can_be_assigned_to_an_upcoming_milestone_in_advance(db, team):
    employee, (project_a, milestone_a), (project_b, milestone_b) = two_projects_with_milestones(db, team)
    assign(db, milestone_a, project_a, employee)
    set_milestone_status(db, milestone_a, "in_progress")

    # Lining up B is fine while it hasn't started...
    assign(db, milestone_b, project_b, employee)
    # ...but it can't start while the employee is still on A
    with pytest.raises(errors.CheckViolation, match="active milestone"):
        set_milestone_status(db, milestone_b, "in_progress")

    set_finished(db, milestone_a, employee, True)
    set_milestone_status(db, milestone_b, "in_progress")


# Time entries


def test_time_entry_hours_must_be_within_a_day(db, team):
    project = make_project(db, team["manager"])
    insert = "INSERT INTO time_entries (user_id, project_id, work_date, hours) VALUES (%s, %s, '2026-01-05', %s)"
    for hours in (0, 25):
        with pytest.raises(errors.CheckViolation):
            db.execute(insert, (team["employee"], project, hours))
    db.execute(insert, (team["employee"], project, 8))


def test_time_entry_milestone_must_belong_to_project(db, team):
    project_a = make_project(db, team["manager"], name="A")
    project_b = make_project(db, team["manager"], name="B")
    milestone_b = add_milestone(db, project_b, 1)
    with pytest.raises(errors.ForeignKeyViolation):
        db.execute("INSERT INTO time_entries (user_id, project_id, milestone_id, work_date, hours) "
                   "VALUES (%s, %s, %s, '2026-01-05', 8)", (team["employee"], project_a, milestone_b))


# Audit


def test_audit_records_actor_changes_and_hides_passwords(db, team):
    AuditRepository(db).set_actor(team["admin"])
    employee = make_user(db, "employee", manager_id=team["manager"], password_hash="secret-hash")
    db.execute("UPDATE users SET job_title = 'Senior Engineer', password_hash = 'new-hash' WHERE id = %s",
               (employee,))
    db.execute("UPDATE users SET job_title = 'Senior Engineer' WHERE id = %s", (employee,))  # no-op

    entries = db.execute("SELECT * FROM audit_log WHERE entity = 'users' AND entity_id = %s ORDER BY id",
                         (employee,)).fetchall()
    assert [e["action"] for e in entries] == ["INSERT", "UPDATE"]
    assert all(e["actor_id"] == team["admin"] for e in entries)
    assert entries[0]["changes"]["role"] == "employee"
    assert entries[1]["changes"] == {
        "job_title": {"old": "Employee", "new": "Senior Engineer"},
        "password": "changed",
    }
    log = db.execute("SELECT string_agg(changes::text, '') AS text FROM audit_log").fetchone()["text"]
    assert "secret-hash" not in log and "new-hash" not in log


def test_record_event_adds_custom_audit_entries(db, team):
    audit = AuditRepository(db)
    audit.set_actor(team["employee"])
    audit.record_event("LOGIN", "users", team["employee"], {"ip": "127.0.0.1"})
    entry = db.execute("SELECT * FROM audit_log WHERE action = 'LOGIN'").fetchone()
    assert entry["actor_id"] == team["employee"]
    assert entry["changes"] == {"ip": "127.0.0.1"}


# Dashboard views


def test_project_status_report(db, team):
    # $104,000 salary = $50/hour; 20 h/week over a 2-week project = $2,000 estimated
    project = make_project(db, team["manager"])
    add_member(db, project, team["employee"], 20)
    first = add_milestone(db, project, 1, "Q1: 250 servers")
    add_milestone(db, project, 2, "Q2: 500 servers")
    set_milestone_status(db, first, "completed")
    db.execute("INSERT INTO time_entries (user_id, project_id, work_date, hours) VALUES (%s, %s, '2026-01-05', 10)",
               (team["employee"], project))

    report = db.execute("SELECT * FROM project_status WHERE project_id = %s", (project,)).fetchone()
    assert report["logged_hours"] == 10
    assert report["labor_cost"] == Decimal("500.00")
    assert report["budget_remaining"] == Decimal("9500.00")
    assert report["estimated_cost"] == Decimal("2000.00")
    assert report["member_count"] == 1
    assert (report["milestones_completed"], report["milestones_total"]) == (1, 2)
    assert report["completion_pct"] == Decimal("50.0")
    assert report["current_milestone"] is None


def test_weekly_hours_flags_more_than_40(db, team):
    project = make_project(db, team["manager"])
    for day in range(5, 10):  # Mon 5 Jan to Fri 9 Jan 2026, 9 hours each
        db.execute("INSERT INTO time_entries (user_id, project_id, work_date, hours) VALUES (%s, %s, %s, 9)",
                   (team["employee"], project, date(2026, 1, day)))
    week = db.execute("SELECT * FROM weekly_hours WHERE user_id = %s", (team["employee"],)).fetchone()
    assert week["week_start"] == date(2026, 1, 5)
    assert week["hours"] == 45
    assert week["over_limit"] is True


def test_employee_allocation_flags_more_than_40(db, team):
    project_a = make_project(db, team["manager"], name="A")
    project_b = make_project(db, team["manager"], name="B")
    add_member(db, project_a, team["employee"], 30)
    add_member(db, project_b, team["employee"], 20)
    add_member(db, project_a, team["employee2"], 40)
    rows = {r["user_id"]: r for r in db.execute("SELECT * FROM employee_allocation").fetchall()}
    assert rows[team["employee"]]["hours_per_week"] == 50
    assert rows[team["employee"]]["over_limit"] is True
    assert rows[team["employee2"]]["over_limit"] is False

    # Archived projects no longer count toward the allocation
    db.execute("UPDATE projects SET archived_at = now(), archive_reason = 'deleted' WHERE id = %s", (project_b,))
    row = db.execute("SELECT * FROM employee_allocation WHERE user_id = %s", (team["employee"],)).fetchone()
    assert row["hours_per_week"] == 30
