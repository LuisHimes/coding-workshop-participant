"""
Tests for the service layer: the business rules and role permissions from the
project brief, run against a real PostgreSQL.

Each test runs in its own temporary schema (see the db fixture in conftest.py).
Run from the service folder: pytest
"""

from datetime import date, timedelta
from decimal import Decimal
from types import SimpleNamespace

import pytest

from models.messages import MessageCreate
from models.milestones import MilestoneCreate, MilestoneTaskCreate, MilestoneTaskUpdate, MilestoneUpdate
from models.projects import ProjectCreate, ProjectMemberCreate, ProjectUpdate
from models.time_entries import TimeEntryCreate, TimeEntryUpdate
from models.users import User, UserCreate, UserSelfUpdate, UserUpdate, UserWithSalary
from repository.audit import AuditRepository
from repository.dashboard import DashboardRepository
from repository.messages import MessageRepository
from repository.milestones import MilestoneRepository
from repository.projects import ProjectRepository
from repository.teams import TeamRepository
from repository.time_entries import TimeEntryRepository
from repository.users import UserRepository
from service.audit import AuditService
from service.errors import ConflictError, InvalidRequestError, NotFoundError, PermissionDeniedError
from service.messages import MessageService
from service.milestones import MilestoneService
from service.projects import ProjectService
from service.reports import ReportService, assess_risk
from service.security import hash_password, verify_password
from service.teams import TeamService
from service.time_entries import TimeEntryService
from service.users import UserService

TODAY = date.today()


@pytest.fixture
def svc(db):
    users, projects = UserRepository(db), ProjectRepository(db)
    milestones, dashboard = MilestoneRepository(db), DashboardRepository(db)
    project_service = ProjectService(projects, users, dashboard)
    team_service = TeamService(TeamRepository(db), users, projects, project_service)
    return SimpleNamespace(
        teams=team_service,
        users=UserService(users),
        projects=project_service,
        milestones=MilestoneService(milestones, projects, project_service),
        time=TimeEntryService(TimeEntryRepository(db), projects, dashboard, project_service),
        messages=MessageService(MessageRepository(db), projects, project_service),
        audit=AuditService(AuditRepository(db)),
        reports=ReportService(dashboard, projects, milestones, users, project_service, team_service,
                              today=lambda: TODAY),
        user_repo=users,
    )


@pytest.fixture
def org(svc):
    """An admin, two managers, and employees: ann and ben report to mia, cal to max."""
    admin = svc.user_repo.create({
        "role": "admin", "first_name": "Ada", "last_name": "Admin", "email": "ada@example.com",
        "job_title": "Administrator", "password_hash": hash_password("admin-password"),
        "must_change_password": False,
    })

    def create(role, first, manager=None, salary="104000"):
        created = svc.users.create_user(admin, UserCreate(
            role=role, first_name=first, last_name="Test", email=f"{first.lower()}@example.com",
            job_title=role.title(), salary=Decimal(salary), manager_id=manager["id"] if manager else None))
        return svc.user_repo.get(created.user.id)

    mia, max_ = create("manager", "Mia"), create("manager", "Max")
    org = SimpleNamespace(admin=admin, mia=mia, max=max_,
                          ann=create("employee", "Ann", mia), ben=create("employee", "Ben", mia),
                          cal=create("employee", "Cal", max_))
    org.project = svc.projects.create_project(admin, ProjectCreate(
        name="Decommission servers", description="Retire 1000 servers", manager_id=mia["id"],
        start_date=TODAY - timedelta(days=10), projected_end_date=TODAY + timedelta(days=80),
        allocated_hours=2000, budget=Decimal("50000")))
    return org


def add_member(svc, org, employee, hours=20, project=None):
    return svc.projects.add_member(org.admin, (project or org.project).id,
                                   ProjectMemberCreate(user_id=employee["id"], hours_per_week=Decimal(hours)))


def add_milestone(svc, org, sequence, title=None, project=None):
    return svc.milestones.create_milestone(org.mia, (project or org.project).id, MilestoneCreate(
        sequence=sequence, title=title or f"Q{sequence}: {250 * sequence} servers",
        start_date=TODAY + timedelta(days=sequence), end_date=TODAY + timedelta(days=20 * sequence)))


def start(svc, org, milestone):
    return svc.milestones.update_milestone(org.mia, milestone.id, MilestoneUpdate(status="in_progress"))


# Users


def test_admin_creates_users_with_generated_id_and_temporary_password(svc, org):
    created = svc.users.create_user(org.admin, UserCreate(
        role="employee", first_name="Dee", last_name="New", email="dee@example.com", job_title="Engineer",
        salary=Decimal("90000"), manager_id=org.mia["id"].lower()))
    assert len(created.user.id) == 6 and created.user.id.isalnum()
    assert created.user.must_change_password is True
    assert created.user.manager_id == org.mia["id"]
    credentials = svc.user_repo.get_credentials(created.user.id)
    assert verify_password(created.temporary_password, credentials["password_hash"])


def test_admins_can_create_other_admins(svc, org):
    created = svc.users.create_user(org.admin, UserCreate(
        role="admin", first_name="Second", last_name="Admin", email="second@example.com", job_title="Admin"))
    assert created.user.role == "admin"


@pytest.mark.parametrize("who", ["mia", "ann"])
def test_only_admins_create_users(svc, org, who):
    with pytest.raises(PermissionDeniedError):
        svc.users.create_user(getattr(org, who), UserCreate(
            role="admin", first_name="X", last_name="Y", email="x@example.com", job_title="X"))


def test_employees_must_report_to_an_active_manager(svc, org):
    with pytest.raises(InvalidRequestError, match="active manager"):
        svc.users.create_user(org.admin, UserCreate(
            role="employee", first_name="Dee", last_name="New", email="dee@example.com", job_title="Engineer",
            salary=Decimal("1"), manager_id=org.ann["id"]))


def test_duplicate_emails_are_reported_clearly(svc, org):
    with pytest.raises(ConflictError, match="email address is already in use"):
        svc.users.create_user(org.admin, UserCreate(
            role="manager", first_name="Mia", last_name="Again", email="MIA@example.com", job_title="Manager"))


def test_salaries_are_visible_to_managers_but_not_employees(svc, org):
    add_member(svc, org, org.ann)
    add_member(svc, org, org.ben)
    assert isinstance(svc.users.get_user(org.mia, org.ann["id"]), UserWithSalary)
    seen_by_employee = svc.users.get_user(org.ann, org.ben["id"])
    assert type(seen_by_employee) is User
    assert "salary" not in seen_by_employee.model_dump()


def test_employees_only_see_their_manager_and_teammates(svc, org):
    add_member(svc, org, org.ann)
    visible = {u.id for u in svc.users.list_users(org.ann)}
    assert visible == {org.ann["id"], org.mia["id"]}
    with pytest.raises(NotFoundError):
        svc.users.get_user(org.ann, org.cal["id"])
    add_member(svc, org, org.cal)
    assert svc.users.get_user(org.ann, org.cal["id"]).id == org.cal["id"]


def test_managers_see_only_themselves_and_employees(svc, org):
    visible = {u.id for u in svc.users.list_users(org.mia)}
    assert visible == {org.mia["id"], org.ann["id"], org.ben["id"], org.cal["id"]}
    assert svc.users.list_users(org.mia, role="manager") == [svc.users.get_user(org.mia, org.mia["id"])]
    assert svc.users.list_users(org.mia, role="admin") == []
    for hidden in (org.max, org.admin):
        with pytest.raises(NotFoundError):
            svc.users.get_user(org.mia, hidden["id"])
    assert {u.id for u in svc.users.list_users(org.admin)} >= {org.admin["id"], org.max["id"]}


def test_users_update_only_their_own_name_and_email(svc, org):
    updated = svc.users.update_self(org.ann, UserSelfUpdate(first_name="Annie", email="annie@example.com"))
    assert (updated.first_name, updated.email, updated.job_title) == ("Annie", "annie@example.com", "Employee")
    with pytest.raises(PermissionDeniedError):
        svc.users.update_user(org.ann, org.ann["id"], UserUpdate(job_title="CEO"))


def test_admin_updates_users_but_cannot_lock_themselves_out(svc, org):
    updated = svc.users.update_user(org.admin, org.ann["id"], UserUpdate(job_title="Senior", salary=Decimal("120000")))
    assert (updated.job_title, updated.salary) == ("Senior", Decimal("120000"))
    with pytest.raises(ConflictError):
        svc.users.update_user(org.admin, org.admin["id"], UserUpdate(is_active=False))
    with pytest.raises(InvalidRequestError, match="active manager"):
        svc.users.update_user(org.admin, org.ann["id"], UserUpdate(manager_id=org.cal["id"]))


def test_admin_resets_passwords(svc, org):
    reset = svc.users.reset_password(org.admin, org.ann["id"])
    assert reset.user.must_change_password is True
    assert verify_password(reset.temporary_password, svc.user_repo.get_credentials(org.ann["id"])["password_hash"])


# Projects


def test_only_admins_create_projects_with_a_real_manager(svc, org):
    with pytest.raises(PermissionDeniedError):
        svc.projects.create_project(org.mia, ProjectCreate(
            name="X", manager_id=org.mia["id"], start_date=TODAY, projected_end_date=TODAY, allocated_hours=1))
    with pytest.raises(InvalidRequestError, match="active manager"):
        svc.projects.create_project(org.admin, ProjectCreate(
            name="X", manager_id=org.ann["id"], start_date=TODAY, projected_end_date=TODAY, allocated_hours=1))


def test_managers_edit_their_projects_but_not_budget_or_manager(svc, org):
    updated = svc.projects.update_project(org.mia, org.project.id, ProjectUpdate(name="Renamed", status="active"))
    assert (updated.name, updated.status) == ("Renamed", "active")
    with pytest.raises(PermissionDeniedError, match="budget"):
        svc.projects.update_project(org.mia, org.project.id, ProjectUpdate(budget=Decimal("1")))
    with pytest.raises(NotFoundError):
        svc.projects.update_project(org.max, org.project.id, ProjectUpdate(name="Mine now"))
    assert svc.projects.update_project(org.admin, org.project.id, ProjectUpdate(budget=Decimal("60000"))).budget == 60000


def test_employees_view_their_projects_but_cannot_edit_them(svc, org):
    with pytest.raises(NotFoundError):
        svc.projects.get_project(org.ann, org.project.id)
    add_member(svc, org, org.ann)
    assert svc.projects.get_project(org.ann, org.project.id).id == org.project.id
    with pytest.raises(PermissionDeniedError):
        svc.projects.update_project(org.ann, org.project.id, ProjectUpdate(name="Ann's"))


def test_employees_never_see_project_budgets(svc, org):
    add_member(svc, org, org.ann)
    assert "budget" not in svc.projects.get_project(org.ann, org.project.id).model_dump()
    assert all("budget" not in p.model_dump() for p in svc.projects.list_projects(org.ann))
    assert svc.projects.get_project(org.mia, org.project.id).budget == Decimal("50000")


def test_project_lists_are_scoped_by_role(svc, org):
    other = svc.projects.create_project(org.admin, ProjectCreate(
        name="Other", manager_id=org.max["id"], start_date=TODAY, projected_end_date=TODAY, allocated_hours=1))
    add_member(svc, org, org.ann)
    assert {p.id for p in svc.projects.list_projects(org.admin)} == {org.project.id, other.id}
    assert [p.id for p in svc.projects.list_projects(org.mia)] == [org.project.id]
    assert [p.id for p in svc.projects.list_projects(org.ann)] == [org.project.id]
    assert [p.id for p in svc.projects.list_projects(org.admin, q="servers")] == [org.project.id]


def test_only_admins_archive_see_archived_and_unarchive(svc, org):
    with pytest.raises(PermissionDeniedError):
        svc.projects.archive_project(org.mia, org.project.id, "deleted")
    archived = svc.projects.archive_project(org.admin, org.project.id, "deleted")
    assert (archived.archive_reason, archived.archived_by) == ("deleted", org.admin["id"])
    with pytest.raises(NotFoundError):
        svc.projects.get_project(org.mia, org.project.id)
    assert svc.projects.list_projects(org.mia, archived=True) == []
    assert [p.id for p in svc.projects.list_projects(org.admin, archived=True)] == [org.project.id]
    with pytest.raises(ConflictError, match="Archived"):
        svc.projects.update_project(org.admin, org.project.id, ProjectUpdate(name="X"))
    assert svc.projects.unarchive_project(org.admin, org.project.id).archived_at is None


def test_projects_archive_as_completed_only_when_complete(svc, org):
    with pytest.raises(ConflictError, match="Only completed projects"):
        svc.projects.archive_project(org.admin, org.project.id, "completed")


def test_project_status_follows_its_flow(svc, org):
    with pytest.raises(ConflictError, match="planning project can't be moved to completed"):
        svc.projects.update_project(org.mia, org.project.id, ProjectUpdate(status="completed"))
    svc.projects.update_project(org.mia, org.project.id, ProjectUpdate(status="active"))
    with pytest.raises(ConflictError, match="milestones must be completed"):
        svc.projects.update_project(org.mia, org.project.id, ProjectUpdate(status="completed"))


def test_completing_a_project_archives_it_until_an_admin_reopens_it(svc, org):
    milestone = add_milestone(svc, org, 1)
    svc.projects.update_project(org.mia, org.project.id, ProjectUpdate(status="active"))
    start(svc, org, milestone)
    svc.milestones.update_milestone(org.mia, milestone.id, MilestoneUpdate(status="completed"))
    svc.projects.update_project(org.mia, org.project.id, ProjectUpdate(status="completed"))

    project = svc.projects.get_project(org.admin, org.project.id)
    assert (project.status, project.archive_reason) == ("completed", "completed")
    assert svc.projects.list_projects(org.mia) == []
    assert svc.reports.project_health(org.mia) == []

    svc.projects.unarchive_project(org.admin, org.project.id)
    reopened = svc.projects.update_project(org.mia, org.project.id, ProjectUpdate(status="active"))
    assert (reopened.status, reopened.archived_at) == ("active", None)



def test_adding_members_reports_allocation_against_40_hours(svc, org):
    other = svc.projects.create_project(org.admin, ProjectCreate(
        name="Other", manager_id=org.mia["id"], start_date=TODAY, projected_end_date=TODAY, allocated_hours=1))
    first = add_member(svc, org, org.ann, 30)
    assert (first.employee_hours_per_week, first.over_limit) == (30, False)
    second = add_member(svc, org, org.ann, 20, project=other)
    assert (second.employee_hours_per_week, second.over_limit) == (50, True)
    with pytest.raises(ConflictError, match="already on this project"):
        add_member(svc, org, org.ann)
    with pytest.raises(InvalidRequestError, match="active employees"):
        add_member(svc, org, org.max)


def test_budget_estimate_uses_salaries_and_planned_hours(svc, org):
    add_member(svc, org, org.ann, 20)  # $104,000 / 2080 = $50/h x 20 h x 13 weeks (91 days)
    assert svc.projects.budget_estimate(org.admin, org.project.id) == Decimal("13000.00")
    with pytest.raises(PermissionDeniedError):
        svc.projects.budget_estimate(org.mia, org.project.id)


# Milestones


def test_only_the_manager_completes_milestones_and_projects(svc, org):
    add_member(svc, org, org.ann)
    first, second = add_milestone(svc, org, 1), add_milestone(svc, org, 2)
    task1 = svc.milestones.create_task(org.mia, first.id, MilestoneTaskCreate(title="Unrack 250 servers"))
    task2 = svc.milestones.create_task(org.mia, second.id, MilestoneTaskCreate(title="Unrack 500 servers"))
    svc.milestones.assign_employee(org.mia, first.id, org.ann["id"])
    svc.milestones.assign_employee(org.mia, second.id, org.ann["id"])  # lined up in advance
    svc.projects.update_project(org.mia, org.project.id, ProjectUpdate(status="active"))
    complete = MilestoneUpdate(status="completed")

    start(svc, org, first)
    with pytest.raises(ConflictError, match="tasks are done"):
        svc.milestones.update_milestone(org.mia, first.id, complete)

    # Ticking off every task leaves the milestone in progress until the manager decides
    done = svc.milestones.update_task(org.ann, task1.id, MilestoneTaskUpdate(is_done=True))
    assert done.done_by == org.ann["id"]
    assert svc.milestones.get_milestone(org.mia, first.id).status == "in_progress"
    with pytest.raises(PermissionDeniedError):
        svc.milestones.update_milestone(org.ann, first.id, complete)
    with pytest.raises(NotFoundError):
        svc.milestones.update_milestone(org.max, first.id, complete)

    assert svc.milestones.update_milestone(org.mia, first.id, complete).status == "completed"
    assert svc.projects.get_project(org.mia, org.project.id).status == "active"

    start(svc, org, second)
    svc.milestones.update_task(org.ann, task2.id, MilestoneTaskUpdate(is_done=True))
    svc.milestones.update_milestone(org.mia, second.id, complete)

    # Every milestone is done, but the project stays open until the manager decides
    assert svc.projects.get_project(org.mia, org.project.id).status == "active"
    with pytest.raises(PermissionDeniedError):
        svc.projects.update_project(org.ann, org.project.id, ProjectUpdate(status="completed"))

    # The manager completes it, which archives it in the same step
    completed = svc.projects.update_project(org.mia, org.project.id, ProjectUpdate(status="completed"))
    assert (completed.status, completed.archive_reason, completed.archived_by) == (
        "completed", "completed", org.mia["id"])
    with pytest.raises(NotFoundError):  # archived projects are admin-only
        svc.projects.get_project(org.mia, org.project.id)


def test_milestones_depend_on_the_previous_one(svc, org):
    add_milestone(svc, org, 1)
    second = add_milestone(svc, org, 2)
    with pytest.raises(ConflictError, match="previous milestones"):
        start(svc, org, second)


def test_employees_tick_off_tasks_only_on_their_milestones(svc, org):
    add_member(svc, org, org.ann)
    milestone = add_milestone(svc, org, 1)
    task = svc.milestones.create_task(org.mia, milestone.id, MilestoneTaskCreate(title="Unrack"))
    with pytest.raises(PermissionDeniedError, match="assigned to"):
        svc.milestones.update_task(org.ann, task.id, MilestoneTaskUpdate(is_done=True))
    svc.milestones.assign_employee(org.mia, milestone.id, org.ann["id"])
    with pytest.raises(PermissionDeniedError, match="only mark tasks"):
        svc.milestones.update_task(org.ann, task.id, MilestoneTaskUpdate(title="Renamed"))
    assert svc.milestones.update_task(org.ann, task.id, MilestoneTaskUpdate(is_done=True)).is_done


def test_employees_have_one_active_milestone(svc, org):
    other = svc.projects.create_project(org.admin, ProjectCreate(
        name="Other", manager_id=org.mia["id"], start_date=TODAY, projected_end_date=TODAY + timedelta(days=30),
        allocated_hours=100))
    add_member(svc, org, org.ann)
    add_member(svc, org, org.ben)
    add_member(svc, org, org.ann, project=other)
    first, elsewhere = add_milestone(svc, org, 1), add_milestone(svc, org, 1, project=other)
    svc.milestones.assign_employee(org.mia, first.id, org.ann["id"])
    svc.milestones.assign_employee(org.mia, elsewhere.id, org.ann["id"])
    start(svc, org, first)
    with pytest.raises(ConflictError, match="already has an active milestone"):
        start(svc, org, elsewhere)

    # Finishing her part frees her
    with pytest.raises(PermissionDeniedError):
        svc.milestones.set_finished(org.ben, first.id, org.ann["id"], True)
    svc.milestones.set_finished(org.ann, first.id, org.ann["id"], True)
    assert svc.milestones.get_active_milestone(org.ann) is None
    start(svc, org, elsewhere)
    assert svc.milestones.get_active_milestone(org.ann).id == elsewhere.id


def test_milestone_rules_for_managers(svc, org):
    milestone = add_milestone(svc, org, 1)
    with pytest.raises(InvalidRequestError, match="Add the employee to the project"):
        svc.milestones.assign_employee(org.mia, milestone.id, org.ann["id"])
    with pytest.raises(NotFoundError):  # another manager's project
        svc.milestones.create_milestone(org.max, org.project.id, MilestoneCreate(
            sequence=2, title="X", start_date=TODAY, end_date=TODAY))
    start(svc, org, milestone)
    with pytest.raises(ConflictError, match="haven't started"):
        svc.milestones.delete_milestone(org.mia, milestone.id)


# Time entries


def test_employees_log_hours_with_a_weekly_total(svc, org):
    add_member(svc, org, org.ann)
    monday = TODAY - timedelta(days=TODAY.weekday())
    for day in range(4):
        entry = svc.time.log_time(org.ann, TimeEntryCreate(
            project_id=org.project.id, work_date=monday + timedelta(days=day), hours=Decimal("9")))
    assert (entry.week_hours, entry.over_limit) == (36, False)
    entry = svc.time.log_time(org.ann, TimeEntryCreate(
        project_id=org.project.id, work_date=monday + timedelta(days=4), hours=Decimal("8")))
    assert (entry.week_hours, entry.over_limit) == (44, True)


def test_only_project_members_log_hours_on_open_projects(svc, org):
    entry = TimeEntryCreate(project_id=org.project.id, work_date=TODAY, hours=Decimal("8"))
    with pytest.raises(NotFoundError):
        svc.time.log_time(org.ann, entry)
    with pytest.raises(PermissionDeniedError):
        svc.time.log_time(org.mia, entry)
    add_member(svc, org, org.ann)
    svc.projects.archive_project(org.admin, org.project.id, "deleted")
    with pytest.raises(ConflictError, match="archived project"):
        svc.time.log_time(org.ann, entry)


def test_time_entries_are_scoped_by_role(svc, org):
    add_member(svc, org, org.ann)
    add_member(svc, org, org.ben)
    ann_entry = svc.time.log_time(org.ann, TimeEntryCreate(project_id=org.project.id, work_date=TODAY, hours=Decimal("8")))
    svc.time.log_time(org.ben, TimeEntryCreate(project_id=org.project.id, work_date=TODAY, hours=Decimal("6")))
    assert {e.user_id for e in svc.time.list_time_entries(org.ann)} == {org.ann["id"]}
    assert len(svc.time.list_time_entries(org.mia)) == 2
    assert svc.time.list_time_entries(org.max) == []
    with pytest.raises(NotFoundError):
        svc.time.update_time_entry(org.ben, ann_entry.id, TimeEntryUpdate(hours=Decimal("1")))
    assert svc.time.update_time_entry(org.ann, ann_entry.id, TimeEntryUpdate(hours=Decimal("7"))).hours == 7


# Message board


def test_message_board_permissions(svc, org):
    other = svc.projects.create_project(org.admin, ProjectCreate(
        name="Other", manager_id=org.max["id"], start_date=TODAY, projected_end_date=TODAY, allocated_hours=1))
    add_member(svc, org, org.ann)
    with pytest.raises(PermissionDeniedError):
        svc.messages.post(org.mia, MessageCreate(body="Hello everyone"))
    svc.messages.post(org.admin, MessageCreate(body="Welcome"))
    kickoff = svc.messages.post(org.mia, MessageCreate(project_id=org.project.id, body="Kickoff Monday"))
    svc.messages.post(org.max, MessageCreate(project_id=other.id, body="Not for Ann"))
    with pytest.raises(NotFoundError):
        svc.messages.post(org.ann, MessageCreate(project_id=other.id, body="Hi"))

    assert {m.body for m in svc.messages.board(org.ann)} == {"Welcome", "Kickoff Monday"}
    assert [m.body for m in svc.messages.board(org.ann, project_id=org.project.id)] == ["Kickoff Monday"]
    assert len(svc.messages.board(org.admin)) == 3
    with pytest.raises(PermissionDeniedError):
        svc.messages.delete(org.ann, kickoff.id)
    svc.messages.delete(org.mia, kickoff.id)


def test_a_reassigned_projects_board_keeps_the_previous_managers_posts(svc, org):
    other = svc.projects.create_project(org.admin, ProjectCreate(
        name="Max's own", manager_id=org.max["id"], start_date=TODAY, projected_end_date=TODAY, allocated_hours=1))
    svc.messages.post(org.mia, MessageCreate(project_id=org.project.id, body="From Mia to her team"))
    svc.messages.post(org.max, MessageCreate(project_id=other.id, body="Max's other project"))
    assert "From Mia to her team" not in {m.body for m in svc.messages.board(org.max)}

    # The project moves to Max: he now sees Mia's post on it, with her name
    svc.projects.update_project(org.admin, org.project.id, ProjectUpdate(manager_id=org.max["id"]))
    [post] = svc.messages.board(org.max, project_id=org.project.id)
    assert (post.body, post.author_name) == ("From Mia to her team", "Mia Test")
    with pytest.raises(PermissionDeniedError):  # but it's still Mia's to delete
        svc.messages.delete(org.max, post.id)
    # Mia no longer manages the project, so its board is gone from hers
    assert "From Mia to her team" not in {m.body for m in svc.messages.board(org.mia)}


# Audit log


def test_only_admins_read_the_audit_log(svc, org):
    entries = svc.audit.list_entries(org.admin, entity="projects")
    assert entries and entries[0].action == "INSERT"
    with pytest.raises(PermissionDeniedError):
        svc.audit.list_entries(org.mia)


# Reports


def status_row(**overrides):
    row = {
        "status": "active", "start_date": TODAY - timedelta(days=50), "projected_end_date": TODAY + timedelta(days=49),
        "completion_pct": Decimal(50), "milestones_total": 4, "milestones_overdue": 0,
        "labor_cost": Decimal(5000), "budget": Decimal(10000), "logged_hours": Decimal(100), "allocated_hours": 1000,
    }
    return {**row, **overrides}


def test_risk_on_track():
    risk, timeline_pct, budget_pct = assess_risk(status_row(), TODAY)
    assert (risk.level, risk.reasons) == ("on_track", [])
    assert (timeline_pct, budget_pct) == (Decimal("51.0"), Decimal("50.0"))


@pytest.mark.parametrize("overrides, level, reason", [
    ({"projected_end_date": TODAY - timedelta(days=1)}, "off_track", "Past its projected end date"),
    ({"labor_cost": Decimal(12000)}, "off_track", "Over budget"),
    ({"completion_pct": Decimal(25)}, "at_risk", "Behind schedule"),
    ({"milestones_overdue": 2}, "at_risk", "2 milestones past their end date"),
    ({"labor_cost": Decimal(8000), "completion_pct": Decimal(50)}, "at_risk", "Spending ahead of progress"),
    ({"logged_hours": Decimal(1200)}, "at_risk", "1200 hours logged against 1000 allocated"),
    ({"milestones_total": 0, "completion_pct": Decimal(0)}, "at_risk", "No milestones defined"),
])
def test_risk_flags(overrides, level, reason):
    risk, _, _ = assess_risk(status_row(**overrides), TODAY)
    assert risk.level == level
    assert any(reason in r for r in risk.reasons)


def test_completed_projects_are_on_track():
    risk, _, _ = assess_risk(status_row(status="completed", projected_end_date=TODAY - timedelta(days=5)), TODAY)
    assert risk.level == "on_track"


def test_project_health_and_budget_reports(svc, org):
    add_member(svc, org, org.ann)
    svc.time.log_time(org.ann, TimeEntryCreate(project_id=org.project.id, work_date=TODAY, hours=Decimal("10")))
    [health] = svc.reports.project_health(org.mia)
    assert health.project_id == org.project.id
    assert health.risk.level == "at_risk"  # started 10 days ago with no milestones
    assert svc.reports.project_health(org.max) == []
    with pytest.raises(PermissionDeniedError):
        svc.reports.project_health(org.ann)

    [budget] = svc.reports.budget(org.admin)
    assert (budget.labor_cost, budget.budget_remaining, budget.budget_used_pct) == (
        Decimal("500.00"), Decimal("49500.00"), Decimal("1.0"))
    assert [p.project_id for p in svc.reports.projects_at_risk(org.mia)] == [org.project.id]


def test_resource_allocation_and_over_allocation(svc, org):
    other = svc.projects.create_project(org.admin, ProjectCreate(
        name="Other", manager_id=org.max["id"], start_date=TODAY, projected_end_date=TODAY, allocated_hours=1))
    add_member(svc, org, org.ann, 30)
    add_member(svc, org, org.ann, 20, project=other)
    add_member(svc, org, org.ben, 40)

    allocation = {a.user_id: a for a in svc.reports.resource_allocation(org.mia)}
    assert set(allocation) == {org.ann["id"], org.ben["id"]}
    ann = allocation[org.ann["id"]]
    assert (ann.hours_per_week, ann.over_limit) == (50, True)
    assert {p.project_name: p.hours_per_week for p in ann.projects} == {"Decommission servers": 30, "Other": 20}
    assert [a.user_id for a in svc.reports.over_allocated(org.mia)] == [org.ann["id"]]
    assert org.cal["id"] in {a.user_id for a in svc.reports.resource_allocation(org.admin)}


def test_deliverables_show_progress_and_the_dependency_chain(svc, org):
    add_member(svc, org, org.ann)
    first, second, third = add_milestone(svc, org, 1), add_milestone(svc, org, 2), add_milestone(svc, org, 3)
    for title in ("Unrack", "Wipe disks"):
        svc.milestones.create_task(org.mia, first.id, MilestoneTaskCreate(title=title))
    svc.milestones.assign_employee(org.mia, first.id, org.ann["id"])
    start(svc, org, first)
    task = svc.milestones.list_tasks(org.mia, first.id)[0]
    svc.milestones.update_task(org.ann, task.id, MilestoneTaskUpdate(is_done=True))

    report = svc.reports.deliverables(org.ann, org.project.id)  # employees can see their project's deliverables
    assert [d.milestone_id for d in report] == [first.id, second.id, third.id]
    assert [d.depends_on_milestone_id for d in report] == [None, first.id, second.id]
    assert [d.blocked for d in report] == [False, True, True]
    assert (report[0].tasks_done, report[0].tasks_total, report[0].completion_pct) == (1, 2, Decimal("50.0"))
    assert report[0].assignees == [org.ann["id"]]
    with pytest.raises(NotFoundError):
        svc.reports.deliverables(org.cal, org.project.id)


def test_home_pages(svc, org):
    add_member(svc, org, org.ann, 40)
    milestone = add_milestone(svc, org, 1)
    svc.milestones.assign_employee(org.mia, milestone.id, org.ann["id"])
    start(svc, org, milestone)
    svc.time.log_time(org.ann, TimeEntryCreate(project_id=org.project.id, work_date=TODAY, hours=Decimal("8")))

    home = svc.reports.manager_home(org.mia)
    assert (home.active_projects, home.total_budget, home.total_labor_cost) == (1, Decimal("50000"), Decimal("400.00"))
    assert [p.project_id for p in home.projects] == [org.project.id]

    mine = svc.reports.employee_home(org.ann)
    assert (mine.active_milestone_id, mine.active_project_id) == (milestone.id, org.project.id)
    assert (mine.project_ids, mine.hours_this_week, mine.over_limit_this_week) == ([org.project.id], 8, False)
    with pytest.raises(PermissionDeniedError):
        svc.reports.employee_home(org.mia)
