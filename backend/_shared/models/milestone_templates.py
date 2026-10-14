"""
Milestone template model: a manager's predefined list of milestones (for
example "Kickoff, Build, Test, Launch") that they can add to any of their
projects in one step, choosing the dates for each milestone when they do.

Rules enforced by PostgreSQL:
- A template belongs to one manager (composite foreign key on the manager's
  role, as for teams), and its names are unique per manager.
- Its milestones are kept in order (sequence), and each can suggest how many
  days it usually takes, used to pre-fill dates.
"""

from datetime import date, datetime

from pydantic import BaseModel, Field, model_validator

from models.base import updated_at_trigger

MAX_MILESTONES = 50

SCHEMA = f"""
CREATE TABLE IF NOT EXISTS milestone_templates (
    id           SERIAL PRIMARY KEY,
    name         VARCHAR(200) NOT NULL CHECK (name <> ''),
    description  TEXT,
    manager_id   VARCHAR(6) NOT NULL,
    manager_role TEXT GENERATED ALWAYS AS ('manager') STORED,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    FOREIGN KEY (manager_id, manager_role) REFERENCES users (id, role)
);

CREATE UNIQUE INDEX IF NOT EXISTS milestone_templates_manager_name_key ON milestone_templates (manager_id, lower(name));
{updated_at_trigger("milestone_templates")}

CREATE TABLE IF NOT EXISTS milestone_template_items (
    id            SERIAL PRIMARY KEY,
    template_id   INTEGER NOT NULL REFERENCES milestone_templates (id) ON DELETE CASCADE,
    sequence      INTEGER NOT NULL CHECK (sequence > 0),
    title         VARCHAR(200) NOT NULL CHECK (title <> ''),
    description   TEXT,
    duration_days INTEGER CHECK (duration_days BETWEEN 1 AND 3650),
    UNIQUE (template_id, sequence)
);
"""


class MilestoneTemplateItemIn(BaseModel):
    """One milestone of a template, without dates; duration_days is a planning hint."""

    title: str = Field(min_length=1, max_length=200)
    description: str | None = None
    duration_days: int | None = Field(default=None, ge=1, le=3650)


class MilestoneTemplateCreate(BaseModel):
    """Managers create templates for themselves; admins must say which manager the template belongs to."""

    name: str = Field(min_length=1, max_length=200)
    description: str | None = None
    manager_id: str | None = Field(default=None, pattern=r"^[A-Za-z0-9]{6}$")
    milestones: list[MilestoneTemplateItemIn] = Field(min_length=1, max_length=MAX_MILESTONES)


class MilestoneTemplateUpdate(BaseModel):
    """Changes the name or description; milestones, when given, replace the whole list in that order."""

    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = None
    milestones: list[MilestoneTemplateItemIn] | None = Field(default=None, min_length=1, max_length=MAX_MILESTONES)


class MilestoneTemplateItem(BaseModel):
    """One milestone of a saved template, in its sequence."""

    id: int
    sequence: int
    title: str
    description: str | None
    duration_days: int | None


class MilestoneTemplate(BaseModel):
    """A manager's milestone template with its milestones in order."""

    id: int
    name: str
    description: str | None
    manager_id: str
    milestones: list[MilestoneTemplateItem]
    created_at: datetime
    updated_at: datetime


class PlannedMilestone(BaseModel):
    """One milestone to add, with its dates (for example from a template)."""

    title: str = Field(min_length=1, max_length=200)
    description: str | None = None
    start_date: date
    end_date: date

    @model_validator(mode="after")
    def check_dates(self):
        """Rejects an end date before the start date."""
        if self.end_date < self.start_date:
            raise ValueError(f'"{self.title}": end_date must be on or after start_date')
        return self


class MilestoneBatchCreate(BaseModel):
    """Milestones to add after the project's existing ones, in this order."""

    milestones: list[PlannedMilestone] = Field(min_length=1, max_length=MAX_MILESTONES)
