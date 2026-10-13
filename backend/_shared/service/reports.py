"""
Reports that answer the platform's key questions:

| Question                                                   | Method                |
| ---------------------------------------------------------- | --------------------- |
| What is the current status of each active project?         | project_health        |
| Which projects are at risk of missing their deadlines?     | projects_at_risk      |
| How are resources allocated across projects?               | resource_allocation   |
| What are the key deliverables and their completion status? | deliverables          |
| Which team members are over-allocated across projects?     | over_allocated        |
| What is the dependency chain between deliverables?         | deliverables          |
| How much budget has been consumed versus planned?          | budget                |

Plus the home pages: manager_home (at-a-glance status) and employee_home.

Managers see their own projects and the employees on them (and their direct
reports); admins see everything. Employees only get deliverables for their
projects and their own home page: costs and salaries stay hidden from them.
"""

from collections.abc import Callable
from datetime import date
from decimal import Decimal

from models.base import HOURS_PER_WEEK
from models.dashboard import (
    BudgetReport, DeliverableReport, DeliverableTask, EmployeeAllocationReport, EmployeeHome,
    EmployeeProjectAllocation, ManagerHome, ProjectHealth, ProjectRisk,
)
from repository.dashboard import DashboardRepository
from repository.milestones import MilestoneRepository
from repository.projects import ProjectRepository
from repository.users import UserRepository
from service.base import is_admin, is_manager, require_role
from service.projects import ProjectService
from service.teams import TeamService

# How far (in percentage points) progress may trail the timeline or the budget
# before a project counts as at risk
PROGRESS_TOLERANCE_PCT = 20


def _pct(part, whole) -> Decimal | None:
    return round(Decimal(100) * Decimal(part) / Decimal(whole), 1) if whole else None


def assess_risk(status: dict, today: date) -> tuple[ProjectRisk, Decimal, Decimal | None]:
    """
    Rates a project's deadline risk from its project_status row. Returns the
    risk, the share of its timeline used, and the share of its budget used.

    off_track: past the projected end date, or over budget.
    at_risk:   overdue milestones, progress trailing the timeline or spending,
               more hours logged than allocated, or no milestones once started.
    """
    total_days = (status["projected_end_date"] - status["start_date"]).days + 1
    elapsed_days = min(max((today - status["start_date"]).days + 1, 0), total_days)
    timeline_pct = _pct(elapsed_days, total_days)
    budget_used_pct = _pct(status["labor_cost"], status["budget"])
    completion = status["completion_pct"]

    if status["status"] == "completed":
        return ProjectRisk(level="on_track", reasons=[]), timeline_pct, budget_used_pct

    reasons, off_track = [], False
    started = today >= status["start_date"]
    if today > status["projected_end_date"]:
        reasons.append(f"Past its projected end date of {status['projected_end_date'].isoformat()}")
        off_track = True
    if status["milestones_overdue"]:
        count = status["milestones_overdue"]
        reasons.append(f"{count} milestone{'s' if count != 1 else ''} past {'their' if count != 1 else 'its'} end date")
    if started and status["milestones_total"] == 0:
        reasons.append("No milestones defined yet")
    elif started and timeline_pct - completion > PROGRESS_TOLERANCE_PCT:
        reasons.append(f"Behind schedule: {completion}% of milestones complete with {timeline_pct}% of the timeline used")
    if budget_used_pct is not None:
        if budget_used_pct > 100:
            reasons.append(f"Over budget: {budget_used_pct}% of the budget used")
            off_track = True
        elif budget_used_pct - completion > PROGRESS_TOLERANCE_PCT:
            reasons.append(f"Spending ahead of progress: {budget_used_pct}% of the budget used "
                           f"for {completion}% completion")
    if status["logged_hours"] > status["allocated_hours"]:
        reasons.append(f"{status['logged_hours']} hours logged against {status['allocated_hours']} allocated")

    level = "off_track" if off_track else "at_risk" if reasons else "on_track"
    return ProjectRisk(level=level, reasons=reasons), timeline_pct, budget_used_pct


class ReportService:
    def __init__(self, dashboard: DashboardRepository, projects: ProjectRepository,
                 milestones: MilestoneRepository, users: UserRepository, project_service: ProjectService,
                 team_service: TeamService, today: Callable[[], date] = date.today):
        self.dashboard = dashboard
        self.projects = projects
        self.milestones = milestones
        self.users = users
        self.project_service = project_service
        self.team_service = team_service
        self.today = today

    # Project status, risk and budget

    def project_health(self, actor: dict, include_archived: bool = False) -> list[ProjectHealth]:
        """Status, completion, hours, budget and deadline risk for each project in scope."""
        require_role(actor, "manager", "admin")
        rows = self.dashboard.project_status(manager_id=actor["id"] if is_manager(actor) else None,
                                             include_archived=include_archived and is_admin(actor))
        today = self.today()
        reports = []
        for row in rows:
            risk, timeline_pct, budget_used_pct = assess_risk(row, today)
            reports.append(ProjectHealth(**row, timeline_pct=timeline_pct, budget_used_pct=budget_used_pct, risk=risk))
        return reports

    def projects_at_risk(self, actor: dict) -> list[ProjectHealth]:
        """Open projects that are at risk or off track, worst first."""
        order = {"off_track": 0, "at_risk": 1}
        flagged = [p for p in self.project_health(actor) if p.risk.level in order]
        return sorted(flagged, key=lambda p: (order[p.risk.level], p.projected_end_date))

    def budget(self, actor: dict) -> list[BudgetReport]:
        """Budget consumed (logged hours x hourly rate) versus planned, per project."""
        return [
            BudgetReport(
                project_id=p.project_id, name=p.name, budget=p.budget, estimated_cost=p.estimated_cost,
                labor_cost=p.labor_cost, budget_remaining=p.budget_remaining, budget_used_pct=p.budget_used_pct,
                completion_pct=p.completion_pct, allocated_hours=p.allocated_hours, logged_hours=p.logged_hours,
                over_budget=p.budget_remaining < 0,
            )
            for p in self.project_health(actor)
        ]

    # Resources

    def resource_allocation(self, actor: dict, team_id: int | None = None) -> list[EmployeeAllocationReport]:
        """Each employee's planned hours per project, against a 40-hour week, optionally for one team."""
        require_role(actor, "manager", "admin")
        user_ids = None
        if team_id is not None:
            user_ids = self.team_service.member_ids(actor, team_id)
        elif is_manager(actor):
            user_ids = {u["id"] for u in self.users.find(role="employee", manager_id=actor["id"])}
            for project in self.projects.find(manager_id=actor["id"]):
                user_ids |= {m["user_id"] for m in self.projects.members_of(project["id"])}
            user_ids = sorted(user_ids)

        reports: dict[str, EmployeeAllocationReport] = {}
        for row in self.dashboard.allocation_details(user_ids):
            report = reports.get(row["user_id"])
            if report is None:
                report = reports[row["user_id"]] = EmployeeAllocationReport(
                    user_id=row["user_id"], first_name=row["first_name"], last_name=row["last_name"],
                    manager_id=row["manager_id"], hours_per_week=row["total_hours_per_week"],
                    over_limit=row["over_limit"], projects=[], last_week_logged_hours=row["last_week_logged_hours"])
            if row["project_id"] is not None:
                report.projects.append(EmployeeProjectAllocation(
                    project_id=row["project_id"], project_name=row["project_name"],
                    hours_per_week=row["hours_per_week"]))
        return list(reports.values())

    def over_allocated(self, actor: dict, team_id: int | None = None) -> list[EmployeeAllocationReport]:
        """Employees planned for more than 40 hours a week, or who logged more than 40 last week."""
        return [a for a in self.resource_allocation(actor, team_id)
                if a.over_limit or a.last_week_logged_hours > HOURS_PER_WEEK]

    # Deliverables

    def deliverables(self, actor: dict, project_id: int) -> list[DeliverableReport]:
        """
        A project's milestones in order, with task progress, assignees, and the
        dependency chain: each milestone depends on the one before it, and is
        blocked until that one is complete.
        """
        self.project_service.get_visible(actor, project_id)
        today = self.today()
        tasks: dict[int, list[dict]] = {}
        for task in self.milestones.tasks_for_project(project_id):
            tasks.setdefault(task["milestone_id"], []).append(task)
        assignees: dict[int, list[str]] = {}
        for assignment in self.milestones.assignees_for_project(project_id):
            assignees.setdefault(assignment["milestone_id"], []).append(assignment["user_id"])

        reports, previous = [], None
        for milestone in self.milestones.for_project(project_id):
            own_tasks = tasks.get(milestone["id"], [])
            done = sum(1 for t in own_tasks if t["is_done"])
            completed = milestone["status"] == "completed"
            completion = Decimal(100) if completed else _pct(done, len(own_tasks)) or Decimal(0)
            # Can't start until the milestone it depends on is complete
            blocked = (milestone["status"] == "not_started"
                       and previous is not None and previous["status"] != "completed")
            reports.append(DeliverableReport(
                milestone_id=milestone["id"], sequence=milestone["sequence"], title=milestone["title"],
                status=milestone["status"], start_date=milestone["start_date"], end_date=milestone["end_date"],
                overdue=not completed and milestone["end_date"] < today,
                depends_on_milestone_id=previous["id"] if previous else None, blocked=blocked,
                tasks_total=len(own_tasks), tasks_done=done, completion_pct=completion,
                assignees=assignees.get(milestone["id"], []),
                tasks=[DeliverableTask(id=t["id"], title=t["title"], is_done=t["is_done"]) for t in own_tasks],
            ))
            previous = milestone
        return reports

    # Home pages

    def manager_home(self, actor: dict) -> ManagerHome:
        """At-a-glance status of the actor's open projects (all projects for admins)."""
        projects = self.project_health(actor)
        return ManagerHome(
            active_projects=sum(1 for p in projects if p.status in ("planning", "active")),
            projects_at_risk=sum(1 for p in projects if p.risk.level == "at_risk"),
            projects_off_track=sum(1 for p in projects if p.risk.level == "off_track"),
            over_allocated_employees=len(self.over_allocated(actor)),
            total_budget=sum((p.budget for p in projects), Decimal(0)),
            total_labor_cost=sum((p.labor_cost for p in projects), Decimal(0)),
            projects=projects,
        )

    def employee_home(self, actor: dict) -> EmployeeHome:
        """An employee's current milestone, projects and hours logged this week."""
        require_role(actor, "employee")
        active = self.milestones.get_active(actor["id"])
        hours = self.dashboard.hours_in_week(actor["id"], self.today())
        return EmployeeHome(
            active_milestone_id=active["id"] if active else None,
            active_milestone_title=active["title"] if active else None,
            active_project_id=active["project_id"] if active else None,
            project_ids=[p["id"] for p in self.projects.find(member_id=actor["id"])],
            hours_this_week=hours,
            over_limit_this_week=hours > HOURS_PER_WEEK,
        )
