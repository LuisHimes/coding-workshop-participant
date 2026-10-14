"""
Projects and their members.

- Admins create projects, choose the manager, set the budget, and archive
  ("delete") or unarchive projects. Only admins see archived projects.
- Managers edit their own projects' details and status, and add, edit and
  remove employees. They cannot change the budget or manager, or archive.
- Employees see only the open projects they are members of.
- Planned hours are checked against a 40-hour week: going over is allowed but
  reported, so managers stay mindful of it.
- A project's status moves planning -> active -> completed. Only the manager
  (or an admin) completes a project, never automatically, and the database
  refuses until every milestone is complete. Completing a project also
  archives it (reason "completed"), so it leaves the manager's view; an admin
  can unarchive it, and its manager can then reopen it as active.
"""

from decimal import Decimal

from models.projects import (
    Project, ProjectCreate, ProjectMember, ProjectMemberAllocation, ProjectMemberCreate, ProjectSummary, ProjectUpdate,
)
from repositories.dashboard import DashboardRepository
from repositories.projects import ProjectRepository
from repositories.users import UserRepository
from services.base import is_admin, is_employee, is_manager, require_role
from services.errors import ConflictError, InvalidRequestError, NotFoundError, PermissionDeniedError, database_rules
from services.users import require_active_manager

# Fields managers may change; budget and manager_id are admin-only
MANAGER_EDITABLE = {"name", "description", "status", "start_date", "projected_end_date", "allocated_hours"}

# Allowed status changes; completed -> active reopens an unarchived project
STATUS_FLOW = {
    "planning": {"active"},
    "active": {"planning", "completed"},
    "completed": {"active"},
}


def present_project(actor: dict, project: dict) -> Project | ProjectSummary:
    """The project as the actor may see it: employees never see the budget."""
    return ProjectSummary.model_validate(project) if is_employee(actor) else Project.model_validate(project)


class ProjectService:
    """Manages projects and their members, and decides who may see or change each project."""

    def __init__(self, projects: ProjectRepository, users: UserRepository, dashboard: DashboardRepository):
        self.projects = projects
        self.users = users
        self.dashboard = dashboard

    # Access helpers, also used by other services

    def get_visible(self, actor: dict, project_id: int) -> dict:
        """The project if the actor may see it, otherwise NotFoundError."""
        project = self.projects.get(project_id)
        if project is None or not self.can_view(actor, project):
            raise NotFoundError("Project not found")
        return project

    def can_view(self, actor: dict, project: dict) -> bool:
        """Admins see every project; others only open ones: managers their own, employees those they are on."""
        if is_admin(actor):
            return True
        if project["archived_at"] is not None:
            return False
        if is_manager(actor):
            return project["manager_id"] == actor["id"]
        return self.projects.is_member(project["id"], actor["id"])

    def get_manageable(self, actor: dict, project_id: int) -> dict:
        """The project if the actor may change it (its manager or an admin) and it is open."""
        project = self.get_visible(actor, project_id)
        if not (is_admin(actor) or project["manager_id"] == actor["id"]):
            raise PermissionDeniedError("Only the project's manager or an admin can change it")
        if project["archived_at"] is not None:
            raise ConflictError("Archived projects can't be changed; unarchive it first")
        return project

    # Projects

    def create_project(self, actor: dict, data: ProjectCreate) -> Project:
        """Admin-only: creates a project for an active manager."""
        require_role(actor, "admin")
        values = data.model_dump()
        values["manager_id"] = require_active_manager(self.users, values["manager_id"])
        with database_rules():
            return Project.model_validate(self.projects.create(values))

    def get_project(self, actor: dict, project_id: int) -> Project | ProjectSummary:
        """The project if the actor may see it, without the budget for employees."""
        return present_project(actor, self.get_visible(actor, project_id))

    def list_projects(self, actor: dict, archived: bool | None = None, status: str | None = None,
                      q: str | None = None, manager_id: str | None = None) -> list[Project | ProjectSummary]:
        """
        Search and filter projects. Admins see archived projects too unless they
        filter with archived=False; managers see their own open projects;
        employees, the open projects they are on.
        """
        if not is_admin(actor):
            archived = False  # only admins see archived projects
        filters = {"archived": archived, "status": status, "q": q,
                   "manager_id": manager_id.upper() if manager_id else None}
        if is_manager(actor):
            filters["manager_id"] = actor["id"]
        elif is_employee(actor):
            filters["member_id"] = actor["id"]
        return [present_project(actor, row) for row in self.projects.find(**filters)]

    def update_project(self, actor: dict, project_id: int, data: ProjectUpdate) -> Project:
        """Completing the project (status "completed") also archives it."""
        values = data.model_dump(exclude_unset=True)
        project = self.get_manageable(actor, project_id)
        if not is_admin(actor) and set(values) - MANAGER_EDITABLE:
            raise PermissionDeniedError("Only admins can change a project's budget or manager")
        if "manager_id" in values:
            values["manager_id"] = require_active_manager(self.users, values["manager_id"])
        if "status" in values and values["status"] != project["status"]:
            if values["status"] not in STATUS_FLOW[project["status"]]:
                raise ConflictError(f"A {project['status']} project can't be moved to {values['status']}")
        start = values.get("start_date", project["start_date"])
        end = values.get("projected_end_date", project["projected_end_date"])
        if end < start:
            raise InvalidRequestError("projected_end_date must be on or after start_date")
        completing = values.get("status") == "completed" and project["status"] != "completed"
        with database_rules(), self.projects.transaction():
            updated = self.projects.update(project_id, values)
            if completing:
                updated = self.projects.archive(project_id, "completed", actor["id"])
        return Project.model_validate(updated)

    def archive_project(self, actor: dict, project_id: int, reason: str) -> Project:
        """Admin-only. reason is 'deleted', or 'completed' for a completed project."""
        require_role(actor, "admin")
        project = self.get_visible(actor, project_id)
        if project["archived_at"] is not None:
            raise ConflictError("Project is already archived")
        if reason == "completed" and project["status"] != "completed":
            raise ConflictError("Only completed projects can be archived as completed")
        with database_rules():
            return Project.model_validate(self.projects.archive(project_id, reason, actor["id"]))

    def unarchive_project(self, actor: dict, project_id: int) -> Project:
        """Admin-only: restores an archived project."""
        require_role(actor, "admin")
        project = self.get_visible(actor, project_id)
        if project["archived_at"] is None:
            raise ConflictError("Project is not archived")
        with database_rules():
            return Project.model_validate(self.projects.unarchive(project_id))

    def budget_estimate(self, actor: dict, project_id: int) -> Decimal:
        """
        Admin-only: what the current team's planned hours cost over the
        project's timeline (salary / 2080 x hours per week x weeks), to guide
        the budget.
        """
        require_role(actor, "admin")
        self.get_visible(actor, project_id)
        [status] = self.dashboard.project_status(project_id=project_id, include_archived=True)
        return status["estimated_cost"]

    # Members

    def list_members(self, actor: dict, project_id: int) -> list[ProjectMember]:
        """The project's members, for anyone who can see the project."""
        self.get_visible(actor, project_id)
        return [ProjectMember.model_validate(row) for row in self.projects.members_of(project_id)]

    def add_member(self, actor: dict, project_id: int, data: ProjectMemberCreate) -> ProjectMemberAllocation:
        """
        The project's manager or an admin adds an active employee. Going over 40
        hours a week is allowed but flagged.
        """
        self.get_manageable(actor, project_id)
        user_id = data.user_id.upper()
        employee = self.users.get(user_id)
        if employee is None or employee["role"] != "employee" or not employee["is_active"]:
            raise InvalidRequestError("Only active employees can be added to a project")
        with database_rules():
            member = self.projects.add_member(project_id, user_id, data.hours_per_week, actor["id"])
        return self.with_allocation(member)

    def update_member_hours(self, actor: dict, project_id: int, user_id: str,
                            hours_per_week: Decimal) -> ProjectMemberAllocation:
        """The project's manager or an admin changes a member's planned weekly hours."""
        self.get_manageable(actor, project_id)
        with database_rules():
            member = self.projects.update_member_hours(project_id, user_id.upper(), hours_per_week)
        if member is None:
            raise NotFoundError("That employee is not on this project")
        return self.with_allocation(member)

    def remove_member(self, actor: dict, project_id: int, user_id: str) -> None:
        """Removes an employee and their milestone assignments. Their logged hours are kept."""
        self.get_manageable(actor, project_id)
        if not self.projects.remove_member(project_id, user_id.upper()):
            raise NotFoundError("That employee is not on this project")

    def with_allocation(self, member: dict) -> ProjectMemberAllocation:
        """A project member plus the employee's planned hours across all open projects."""
        allocation = self.dashboard.employee_allocation(member["user_id"])
        return ProjectMemberAllocation(
            **member, employee_hours_per_week=allocation["hours_per_week"], over_limit=allocation["over_limit"])
