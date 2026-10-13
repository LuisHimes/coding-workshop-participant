"""
Dashboard views: read-only reports computed by PostgreSQL.

- project_status: completion, hours and budget for each project; feeds the
  manager's home page message board and the full status dashboard.
- weekly_hours: hours each employee logged per week, flagged above 40.
- employee_allocation: weekly hours each employee is planned for across
  their open projects, flagged above 40.

Labor cost is logged hours x hourly rate (salary / 2080). Estimated cost is
what the planned allocation would cost over the project's whole timeline,
which admins can use when setting the budget.
"""

from datetime import date
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel

from models.base import HOURS_PER_WEEK, HOURS_PER_YEAR
from models.projects import ProjectStatus

SCHEMA = f"""
CREATE OR REPLACE VIEW project_status AS
SELECT
    p.id AS project_id,
    p.name,
    p.status,
    p.archived_at IS NOT NULL AS archived,
    p.manager_id,
    p.start_date,
    p.projected_end_date,
    p.allocated_hours,
    coalesce(t.logged_hours, 0) AS logged_hours,
    p.budget,
    round(coalesce(t.labor_cost, 0), 2) AS labor_cost,
    round(p.budget - coalesce(t.labor_cost, 0), 2) AS budget_remaining,
    round(coalesce(team.estimated_cost, 0), 2) AS estimated_cost,
    team.member_count,
    ms.milestones_total,
    ms.milestones_completed,
    CASE WHEN ms.milestones_total = 0 THEN 0
         ELSE round(100.0 * ms.milestones_completed / ms.milestones_total, 1)
    END AS completion_pct,
    ms.current_milestone,
    ms.milestones_overdue
FROM projects p
LEFT JOIN LATERAL (
    SELECT sum(te.hours) AS logged_hours,
           sum(te.hours * u.salary / {HOURS_PER_YEAR}) AS labor_cost
    FROM time_entries te
    JOIN users u ON u.id = te.user_id
    WHERE te.project_id = p.id
) t ON true
LEFT JOIN LATERAL (
    SELECT count(*) AS member_count,
           sum(u.salary / {HOURS_PER_YEAR} * pm.hours_per_week
               * (p.projected_end_date - p.start_date + 1) / 7.0) AS estimated_cost
    FROM project_members pm
    JOIN users u ON u.id = pm.user_id
    WHERE pm.project_id = p.id
) team ON true
LEFT JOIN LATERAL (
    SELECT count(*) AS milestones_total,
           count(*) FILTER (WHERE status = 'completed') AS milestones_completed,
           min(title) FILTER (WHERE status = 'in_progress') AS current_milestone,
           count(*) FILTER (WHERE status <> 'completed' AND end_date < CURRENT_DATE) AS milestones_overdue
    FROM milestones
    WHERE project_id = p.id
) ms ON true;

CREATE OR REPLACE VIEW weekly_hours AS
SELECT
    user_id,
    date_trunc('week', work_date)::date AS week_start,
    sum(hours) AS hours,
    sum(hours) > {HOURS_PER_WEEK} AS over_limit
FROM time_entries
GROUP BY user_id, date_trunc('week', work_date);

CREATE OR REPLACE VIEW employee_allocation AS
SELECT
    u.id AS user_id,
    coalesce(sum(pm.hours_per_week), 0) AS hours_per_week,
    coalesce(sum(pm.hours_per_week), 0) > {HOURS_PER_WEEK} AS over_limit
FROM users u
LEFT JOIN project_members pm ON pm.user_id = u.id
    AND pm.project_id IN (
        SELECT id FROM projects WHERE archived_at IS NULL AND status IN ('planning', 'active'))
WHERE u.role = 'employee'
GROUP BY u.id;
"""


class ProjectStatusReport(BaseModel):
    project_id: int
    name: str
    status: ProjectStatus
    archived: bool
    manager_id: str
    start_date: date
    projected_end_date: date
    allocated_hours: int
    logged_hours: Decimal
    budget: Decimal
    labor_cost: Decimal
    budget_remaining: Decimal
    estimated_cost: Decimal
    member_count: int
    milestones_total: int
    milestones_completed: int
    completion_pct: Decimal
    current_milestone: str | None
    milestones_overdue: int


# Reports built by service/reports.py on top of the views

RiskLevel = Literal["on_track", "at_risk", "off_track"]


class ProjectRisk(BaseModel):
    level: RiskLevel
    reasons: list[str]


class ProjectHealth(ProjectStatusReport):
    """Project status plus how far through its timeline and budget it is, and its deadline risk."""

    timeline_pct: Decimal
    budget_used_pct: Decimal | None
    risk: ProjectRisk


class EmployeeProjectAllocation(BaseModel):
    project_id: int
    project_name: str
    hours_per_week: Decimal


class EmployeeAllocationReport(BaseModel):
    """One employee's planned hours across their open projects, and their latest logged week."""

    user_id: str
    first_name: str
    last_name: str
    manager_id: str | None
    hours_per_week: Decimal
    over_limit: bool
    projects: list[EmployeeProjectAllocation]
    last_week_logged_hours: Decimal


class DeliverableTask(BaseModel):
    id: int
    title: str
    is_done: bool


class DeliverableReport(BaseModel):
    """A milestone as a deliverable: progress, the milestone it depends on, and whether it is blocked."""

    milestone_id: int
    sequence: int
    title: str
    status: str
    start_date: date
    end_date: date
    overdue: bool
    depends_on_milestone_id: int | None
    blocked: bool
    tasks_total: int
    tasks_done: int
    completion_pct: Decimal
    assignees: list[str]
    tasks: list[DeliverableTask]


class BudgetReport(BaseModel):
    """Budget consumed versus planned for one project."""

    project_id: int
    name: str
    budget: Decimal
    estimated_cost: Decimal
    labor_cost: Decimal
    budget_remaining: Decimal
    budget_used_pct: Decimal | None
    completion_pct: Decimal
    allocated_hours: int
    logged_hours: Decimal
    over_budget: bool


class ManagerHome(BaseModel):
    """At-a-glance summary for a manager's (or admin's) home page."""

    active_projects: int
    projects_at_risk: int
    projects_off_track: int
    over_allocated_employees: int
    total_budget: Decimal
    total_labor_cost: Decimal
    projects: list[ProjectHealth]


class EmployeeHome(BaseModel):
    """An employee's home page: what they are working on and this week's hours."""

    active_milestone_id: int | None
    active_milestone_title: str | None
    active_project_id: int | None
    project_ids: list[int]
    hours_this_week: Decimal
    over_limit_this_week: bool
