"""
Project, member, milestone-creation and deliverable routes. Permissions are
checked in the services.
"""

from fastapi import APIRouter, Response, status

from dependencies import CurrentUser, MilestoneServiceDep, ProjectServiceDep, ReportServiceDep, TeamServiceDep
from models.dashboard import DeliverableReport
from models.teams import TeamProjectAssignment, TeamStaffingResult
from models.milestone_templates import MilestoneBatchCreate
from models.milestones import Milestone, MilestoneCreate
from models.projects import (
    BudgetEstimate, Project, ProjectArchive, ProjectCreate, ProjectMember, ProjectMemberAllocation,
    ProjectMemberCreate, ProjectMemberUpdate, ProjectStatus, ProjectSummary, ProjectUpdate,
)

router = APIRouter(prefix="/projects", tags=["projects"])


@router.get("")
def list_projects(user: CurrentUser, projects: ProjectServiceDep, archived: bool | None = None,
                  status: ProjectStatus | None = None, q: str | None = None,
                  manager_id: str | None = None) -> list[Project | ProjectSummary]:
    """
    Search and filter projects. Admins get archived projects too, marked
    "archived": true; filter with archived=true or archived=false. Managers see
    their own open projects; employees, the open projects they are on.
    """
    return projects.list_projects(user, archived=archived, status=status, q=q, manager_id=manager_id)


@router.post("", status_code=status.HTTP_201_CREATED)
def create_project(body: ProjectCreate, user: CurrentUser, projects: ProjectServiceDep) -> Project:
    """Admin-only: create a project, choosing its manager and budget."""
    return projects.create_project(user, body)


@router.get("/{project_id}")
def get_project(project_id: int, user: CurrentUser, projects: ProjectServiceDep) -> Project | ProjectSummary:
    """Employees get the project without its budget."""
    return projects.get_project(user, project_id)


@router.patch("/{project_id}")
def update_project(project_id: int, body: ProjectUpdate, user: CurrentUser, projects: ProjectServiceDep) -> Project:
    """Managers edit their own projects; budget and manager are admin-only. Completing a project archives it."""
    return projects.update_project(user, project_id, body)


@router.delete("/{project_id}")
def delete_project(project_id: int, user: CurrentUser, projects: ProjectServiceDep,
                   body: ProjectArchive | None = None) -> Project:
    """
    Admin-only: delete a project by archiving it, so its history and audit
    trail are kept. The optional body sets the reason: "deleted" (the default)
    or "completed". Returns the archived project.
    """
    return projects.archive_project(user, project_id, (body or ProjectArchive()).reason)


@router.post("/{project_id}/unarchive")
def unarchive_project(project_id: int, user: CurrentUser, projects: ProjectServiceDep) -> Project:
    """Admin-only: restore an archived project."""
    return projects.unarchive_project(user, project_id)


@router.get("/{project_id}/budget-estimate")
def budget_estimate(project_id: int, user: CurrentUser, projects: ProjectServiceDep) -> BudgetEstimate:
    """Admin-only: what the current team's planned hours cost, to guide the budget."""
    return BudgetEstimate(project_id=project_id, estimated_cost=projects.budget_estimate(user, project_id))


# Members


@router.get("/{project_id}/members")
def list_members(project_id: int, user: CurrentUser, projects: ProjectServiceDep) -> list[ProjectMember]:
    return projects.list_members(user, project_id)


@router.post("/{project_id}/members", status_code=status.HTTP_201_CREATED)
def add_member(project_id: int, body: ProjectMemberCreate, user: CurrentUser,
               projects: ProjectServiceDep) -> ProjectMemberAllocation:
    """Adds an employee; the response flags them if their planned hours go over 40 a week."""
    return projects.add_member(user, project_id, body)


@router.patch("/{project_id}/members/{user_id}")
def update_member(project_id: int, user_id: str, body: ProjectMemberUpdate, user: CurrentUser,
                  projects: ProjectServiceDep) -> ProjectMemberAllocation:
    return projects.update_member_hours(user, project_id, user_id, body.hours_per_week)


@router.delete("/{project_id}/members/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_member(project_id: int, user_id: str, user: CurrentUser, projects: ProjectServiceDep) -> Response:
    projects.remove_member(user, project_id, user_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# Milestones and deliverables


@router.get("/{project_id}/milestones")
def list_milestones(project_id: int, user: CurrentUser, milestones: MilestoneServiceDep) -> list[Milestone]:
    return milestones.list_milestones(user, project_id)


@router.post("/{project_id}/milestones", status_code=status.HTTP_201_CREATED)
def create_milestone(project_id: int, body: MilestoneCreate, user: CurrentUser,
                     milestones: MilestoneServiceDep) -> Milestone:
    return milestones.create_milestone(user, project_id, body)


@router.post("/{project_id}/milestones/batch", status_code=status.HTTP_201_CREATED)
def create_milestones(project_id: int, body: MilestoneBatchCreate, user: CurrentUser,
                      milestones: MilestoneServiceDep) -> list[Milestone]:
    """Adds several milestones (for example from a milestone template) after the existing ones, all or none."""
    return milestones.create_milestones(user, project_id, body)


@router.get("/{project_id}/deliverables")
def deliverables(project_id: int, user: CurrentUser, reports: ReportServiceDep) -> list[DeliverableReport]:
    """Milestones in order with task progress, assignees and the dependency chain."""
    return reports.deliverables(user, project_id)


@router.post("/{project_id}/teams")
def add_team_to_project(project_id: int, body: TeamProjectAssignment, user: CurrentUser,
                        teams: TeamServiceDep) -> TeamStaffingResult:
    """
    Adds every active member of one of your teams who isn't on the project
    yet, with the same weekly hours. Lists who was added (flagging anyone over
    40 hours a week) and who was skipped.
    """
    return teams.add_team_to_project(user, project_id, body.team_id, body.hours_per_week)
