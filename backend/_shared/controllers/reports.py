"""
Dashboard and report routes. Managers see their own projects and team, admins
everything (checked in ReportService). Deliverables are under
/projects/{project_id}/deliverables.
"""

from fastapi import APIRouter

from dependencies import CurrentUser, ReportServiceDep
from models.dashboard import BudgetReport, EmployeeAllocationReport, EmployeeHome, ManagerHome, ProjectHealth
from services.base import is_employee

router = APIRouter(prefix="/reports", tags=["reports"])


@router.get("/home")
def home(user: CurrentUser, reports: ReportServiceDep) -> ManagerHome | EmployeeHome:
    """
    Home page summary: project status at a glance for managers and admins; the
    active milestone and this week's hours for employees.
    """
    return reports.employee_home(user) if is_employee(user) else reports.manager_home(user)


@router.get("/projects")
def project_health(user: CurrentUser, reports: ReportServiceDep, include_archived: bool = False) -> list[ProjectHealth]:
    """Status, completion, hours, budget and deadline risk of each project."""
    return reports.project_health(user, include_archived=include_archived)


@router.get("/at-risk")
def projects_at_risk(user: CurrentUser, reports: ReportServiceDep) -> list[ProjectHealth]:
    """Projects at risk of missing their deadlines, worst first, with the reasons."""
    return reports.projects_at_risk(user)


@router.get("/budget")
def budget(user: CurrentUser, reports: ReportServiceDep) -> list[BudgetReport]:
    """Budget consumed versus planned for each project."""
    return reports.budget(user)


@router.get("/allocation")
def resource_allocation(user: CurrentUser, reports: ReportServiceDep,
                        team_id: int | None = None) -> list[EmployeeAllocationReport]:
    """Each employee's planned hours per project, against a 40-hour week; team_id narrows it to one team."""
    return reports.resource_allocation(user, team_id=team_id)


@router.get("/over-allocated")
def over_allocated(user: CurrentUser, reports: ReportServiceDep,
                   team_id: int | None = None) -> list[EmployeeAllocationReport]:
    """Employees planned for, or who logged, more than 40 hours a week; team_id narrows it to one team."""
    return reports.over_allocated(user, team_id=team_id)
