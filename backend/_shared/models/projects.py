"""
Project model: projects and the employees assigned to them.

Each project has exactly one manager, enforced by a composite foreign key
to users(id, role), like the employee -> manager link. Projects are never
deleted: deleting or finishing a project archives it (archived_at and
archive_reason), and admins can unarchive it again. A project can only be
marked completed once all of its milestones are completed.
"""

from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field, computed_field, model_validator

from models.base import HOURS_PER_WEEK, updated_at_trigger

ProjectStatus = Literal["planning", "active", "completed"]
ArchiveReason = Literal["deleted", "completed"]

# What project search matches against; the trigram index uses this exact expression
SEARCH_TEXT = "(name || ' ' || coalesce(description, ''))"

SCHEMA = f"""
CREATE TABLE IF NOT EXISTS projects (
    id                 SERIAL PRIMARY KEY,
    name               VARCHAR(200) NOT NULL CHECK (name <> ''),
    description        TEXT,
    manager_id         VARCHAR(6) NOT NULL,
    manager_role       TEXT GENERATED ALWAYS AS ('manager') STORED,
    status             TEXT NOT NULL DEFAULT 'planning'
                       CONSTRAINT projects_status_check CHECK (status IN ('planning', 'active', 'completed')),
    start_date         DATE NOT NULL,
    projected_end_date DATE NOT NULL,
    allocated_hours    INTEGER NOT NULL CHECK (allocated_hours > 0),
    budget             NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (budget >= 0),
    archived_at        TIMESTAMPTZ,
    archived_by        VARCHAR(6) REFERENCES users (id),
    archive_reason     TEXT CHECK (archive_reason IN ('deleted', 'completed')),
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    FOREIGN KEY (manager_id, manager_role) REFERENCES users (id, role),
    CHECK (projected_end_date >= start_date),
    CHECK ((archived_at IS NULL) = (archive_reason IS NULL)),
    CONSTRAINT projects_archive_reason_status_check
        CHECK (archive_reason IS DISTINCT FROM 'completed' OR status = 'completed')
);

CREATE INDEX IF NOT EXISTS projects_manager_id_idx ON projects (manager_id);
CREATE INDEX IF NOT EXISTS projects_search_idx ON projects USING gin ({SEARCH_TEXT} public.gin_trgm_ops);
{updated_at_trigger("projects")}

-- Only employees can be project members; managers lead through projects.manager_id
CREATE TABLE IF NOT EXISTS project_members (
    id             SERIAL PRIMARY KEY,
    project_id     INTEGER NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
    user_id        VARCHAR(6) NOT NULL,
    member_role    TEXT GENERATED ALWAYS AS ('employee') STORED,
    hours_per_week NUMERIC(4, 1) NOT NULL DEFAULT {HOURS_PER_WEEK}
                   CHECK (hours_per_week > 0 AND hours_per_week <= {HOURS_PER_WEEK}),
    assigned_by    VARCHAR(6) REFERENCES users (id),
    assigned_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (project_id, user_id),
    FOREIGN KEY (user_id, member_role) REFERENCES users (id, role)
);

CREATE INDEX IF NOT EXISTS project_members_user_id_idx ON project_members (user_id);

CREATE OR REPLACE FUNCTION check_project() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    -- A project is completed only when it has milestones and all are completed
    IF NEW.status = 'completed'
       AND (TG_OP = 'INSERT' OR OLD.status <> 'completed')
       AND (NOT EXISTS (SELECT 1 FROM milestones WHERE project_id = NEW.id)
            OR EXISTS (SELECT 1 FROM milestones WHERE project_id = NEW.id AND status <> 'completed')) THEN
        RAISE EXCEPTION 'Project % cannot be %: all milestones must be completed first', NEW.id, NEW.status
            USING ERRCODE = 'check_violation';
    END IF;

    -- Unarchiving must not give an employee a second active milestone
    IF TG_OP = 'UPDATE' AND OLD.archived_at IS NOT NULL AND NEW.archived_at IS NULL
       AND EXISTS (
           SELECT 1
           FROM milestone_assignments mine
           JOIN milestones m ON m.id = mine.milestone_id AND m.status = 'in_progress'
           JOIN milestone_assignments other ON other.user_id = mine.user_id AND other.project_id <> NEW.id
               AND other.finished_at IS NULL
           JOIN milestones om ON om.id = other.milestone_id AND om.status = 'in_progress'
           JOIN projects op ON op.id = om.project_id AND op.archived_at IS NULL
           WHERE mine.project_id = NEW.id AND mine.finished_at IS NULL) THEN
        RAISE EXCEPTION 'Project % cannot be unarchived: an assigned employee already has an active milestone', NEW.id
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END $$;

CREATE OR REPLACE TRIGGER projects_check BEFORE INSERT OR UPDATE ON projects
FOR EACH ROW EXECUTE FUNCTION check_project();
"""


class ProjectCreate(BaseModel):
    """Admin-only: create a project, choosing its manager and budget."""

    name: str = Field(min_length=1, max_length=200)
    description: str | None = None
    manager_id: str = Field(pattern=r"^[A-Za-z0-9]{6}$")
    start_date: date
    projected_end_date: date
    allocated_hours: int = Field(gt=0)
    budget: Decimal = Field(default=Decimal(0), ge=0, max_digits=14, decimal_places=2)

    @model_validator(mode="after")
    def check_dates(self):
        if self.projected_end_date < self.start_date:
            raise ValueError("projected_end_date must be on or after start_date")
        return self


class ProjectUpdate(BaseModel):
    """Managers and admins: project details. Budget and manager are admin-only."""

    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = None
    status: ProjectStatus | None = None
    start_date: date | None = None
    projected_end_date: date | None = None
    allocated_hours: int | None = Field(default=None, gt=0)
    budget: Decimal | None = Field(default=None, ge=0, max_digits=14, decimal_places=2)
    manager_id: str | None = Field(default=None, pattern=r"^[A-Za-z0-9]{6}$")


class ProjectSummary(BaseModel):
    """A project as employees see it: no budget, as they never see costs."""

    id: int
    name: str
    description: str | None
    manager_id: str
    status: ProjectStatus
    start_date: date
    projected_end_date: date
    allocated_hours: int
    archived_at: datetime | None
    archived_by: str | None
    archive_reason: ArchiveReason | None
    created_at: datetime
    updated_at: datetime

    @computed_field
    @property
    def archived(self) -> bool:
        return self.archived_at is not None


class Project(ProjectSummary):
    """A project as managers and admins see it, with its budget."""

    budget: Decimal


class ProjectMemberCreate(BaseModel):
    user_id: str = Field(pattern=r"^[A-Za-z0-9]{6}$")
    hours_per_week: Decimal = Field(default=Decimal(HOURS_PER_WEEK), gt=0, le=HOURS_PER_WEEK)


class ProjectMember(BaseModel):
    id: int
    project_id: int
    user_id: str
    hours_per_week: Decimal
    assigned_by: str | None
    assigned_at: datetime


class ProjectMemberAllocation(ProjectMember):
    """A member, plus the employee's planned hours across all open projects (40 is a full week)."""

    employee_hours_per_week: Decimal
    over_limit: bool


class ProjectArchive(BaseModel):
    """Optional body for deleting (archiving) a project; the reason defaults to "deleted"."""

    reason: ArchiveReason = "deleted"


class BudgetEstimate(BaseModel):
    """What the current team's planned hours cost over the project's timeline."""

    project_id: int
    estimated_cost: Decimal


class ProjectMemberUpdate(BaseModel):
    hours_per_week: Decimal = Field(gt=0, le=HOURS_PER_WEEK)
