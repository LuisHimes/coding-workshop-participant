"""
Time entry model: hours employees log against a project (and optionally a
milestone). Logged hours drive budget tracking and the 40-hour week report.

Entries reference users and projects directly rather than project_members,
so removing an employee from a project keeps their history for the budget.
"""

from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, Field

from models.base import updated_at_trigger

SCHEMA = f"""
CREATE TABLE IF NOT EXISTS time_entries (
    id           SERIAL PRIMARY KEY,
    user_id      VARCHAR(6) NOT NULL REFERENCES users (id),
    project_id   INTEGER NOT NULL REFERENCES projects (id),
    milestone_id INTEGER,
    work_date    DATE NOT NULL,
    hours        NUMERIC(4, 2) NOT NULL CHECK (hours > 0 AND hours <= 24),
    description  TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    FOREIGN KEY (milestone_id, project_id) REFERENCES milestones (id, project_id)
);

CREATE INDEX IF NOT EXISTS time_entries_user_date_idx ON time_entries (user_id, work_date);
CREATE INDEX IF NOT EXISTS time_entries_project_date_idx ON time_entries (project_id, work_date);
-- Checked when a milestone is deleted
CREATE INDEX IF NOT EXISTS time_entries_milestone_id_idx ON time_entries (milestone_id) WHERE milestone_id IS NOT NULL;
{updated_at_trigger("time_entries")}
"""


class TimeEntryCreate(BaseModel):
    """Employees: log hours worked on a project, optionally against one of its milestones."""

    project_id: int
    milestone_id: int | None = None
    work_date: date
    hours: Decimal = Field(gt=0, le=24, max_digits=4, decimal_places=2)
    description: str | None = None


class TimeEntryUpdate(BaseModel):
    """Change an entry's date, hours or description. Only the fields sent are changed."""

    work_date: date | None = None
    hours: Decimal | None = Field(default=None, gt=0, le=24, max_digits=4, decimal_places=2)
    description: str | None = None


class TimeEntry(BaseModel):
    """Hours an employee logged on a project for one day."""

    id: int
    user_id: str
    project_id: int
    milestone_id: int | None
    work_date: date
    hours: Decimal
    description: str | None
    created_at: datetime
    updated_at: datetime


class TimeEntryLogged(TimeEntry):
    """A saved entry, plus the employee's total for that week (40 is a full week)."""

    week_hours: Decimal
    over_limit: bool
