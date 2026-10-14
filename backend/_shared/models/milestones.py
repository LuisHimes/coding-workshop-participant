"""
Milestone model: ordered checkpoints within a project, their tasks, and the
employees working on them.

Rules enforced by PostgreSQL triggers:
- Milestones run in sequence: one can only start once every earlier
  milestone in the project is completed, and a completed milestone can only
  be reopened while no later milestone has started.
- A milestone can only be completed once all of its tasks are done.
- An employee can have only one active milestone at a time, across all of
  their non-archived projects. An assignment is active while its milestone
  is in progress and the employee has not finished their part
  (finished_at is NULL). Finishing, or completing the milestone, frees the
  employee to work on another milestone. Employees can be assigned to
  upcoming milestones in advance; the check applies when work would start.
- Milestones of a completed project cannot change status.
"""

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field, model_validator

from models.base import updated_at_trigger

MilestoneStatus = Literal["not_started", "in_progress", "completed"]

SCHEMA = f"""
CREATE TABLE IF NOT EXISTS milestones (
    id           SERIAL PRIMARY KEY,
    project_id   INTEGER NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
    sequence     INTEGER NOT NULL CHECK (sequence > 0),
    title        VARCHAR(200) NOT NULL CHECK (title <> ''),
    description  TEXT,
    start_date   DATE NOT NULL,
    end_date     DATE NOT NULL,
    status       TEXT NOT NULL DEFAULT 'not_started'
                 CHECK (status IN ('not_started', 'in_progress', 'completed')),
    completed_at TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (project_id, sequence),
    UNIQUE (id, project_id),
    CHECK (end_date >= start_date),
    CHECK ((status = 'completed') = (completed_at IS NOT NULL))
);
{updated_at_trigger("milestones")}

-- The requirements that make up a milestone ("250 servers decommissioned", ...)
CREATE TABLE IF NOT EXISTS milestone_tasks (
    id           SERIAL PRIMARY KEY,
    milestone_id INTEGER NOT NULL REFERENCES milestones (id) ON DELETE CASCADE,
    title        VARCHAR(200) NOT NULL CHECK (title <> ''),
    is_done      BOOLEAN NOT NULL DEFAULT false,
    done_at      TIMESTAMPTZ,
    done_by      VARCHAR(6) REFERENCES users (id),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (is_done = (done_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS milestone_tasks_milestone_id_idx ON milestone_tasks (milestone_id);
{updated_at_trigger("milestone_tasks")}

-- Employees working on a milestone; they must be members of its project
CREATE TABLE IF NOT EXISTS milestone_assignments (
    id           SERIAL PRIMARY KEY,
    milestone_id INTEGER NOT NULL,
    project_id   INTEGER NOT NULL,
    user_id      VARCHAR(6) NOT NULL,
    assigned_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at  TIMESTAMPTZ,
    UNIQUE (milestone_id, user_id),
    FOREIGN KEY (milestone_id, project_id) REFERENCES milestones (id, project_id) ON DELETE CASCADE,
    FOREIGN KEY (project_id, user_id) REFERENCES project_members (project_id, user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS milestone_assignments_user_id_idx ON milestone_assignments (user_id);
-- Project-wide lookups, and cascades when a member is removed from a project
CREATE INDEX IF NOT EXISTS milestone_assignments_project_user_idx ON milestone_assignments (project_id, user_id);

-- Returns an employee from the given list who already has an active milestone
-- other than the given one. Locks the employees' rows so concurrent requests
-- cannot both pass the check.
CREATE OR REPLACE FUNCTION find_busy_employee(employee_ids varchar[], exclude_milestone_id integer)
RETURNS varchar LANGUAGE plpgsql AS $$
DECLARE
    busy varchar;
BEGIN
    PERFORM 1 FROM users WHERE id = ANY(employee_ids) ORDER BY id FOR NO KEY UPDATE;
    SELECT ma.user_id INTO busy
    FROM milestone_assignments ma
    JOIN milestones m ON m.id = ma.milestone_id AND m.status = 'in_progress'
    JOIN projects p ON p.id = m.project_id AND p.archived_at IS NULL
    WHERE ma.user_id = ANY(employee_ids) AND ma.milestone_id <> exclude_milestone_id
      AND ma.finished_at IS NULL
    LIMIT 1;
    RETURN busy;
END $$;

CREATE OR REPLACE FUNCTION check_milestone() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    busy varchar;
BEGIN
    NEW.completed_at := CASE WHEN NEW.status = 'completed' THEN coalesce(NEW.completed_at, now()) END;
    IF TG_OP = 'UPDATE' AND NEW.status = OLD.status THEN
        RETURN NEW;
    END IF;

    IF TG_OP = 'UPDATE' AND EXISTS (
        SELECT 1 FROM projects WHERE id = NEW.project_id AND status = 'completed') THEN
        RAISE EXCEPTION 'Milestones of a completed project cannot change status'
            USING ERRCODE = 'check_violation';
    END IF;

    IF NEW.status <> 'not_started' AND EXISTS (
        SELECT 1 FROM milestones
        WHERE project_id = NEW.project_id AND sequence < NEW.sequence AND status <> 'completed') THEN
        RAISE EXCEPTION 'Milestone % cannot start until all previous milestones are completed', NEW.sequence
            USING ERRCODE = 'check_violation';
    END IF;

    IF TG_OP = 'UPDATE' AND OLD.status = 'completed' AND EXISTS (
        SELECT 1 FROM milestones
        WHERE project_id = NEW.project_id AND sequence > NEW.sequence AND status <> 'not_started') THEN
        RAISE EXCEPTION 'Milestone % cannot be reopened after a later milestone has started', NEW.sequence
            USING ERRCODE = 'check_violation';
    END IF;

    IF NEW.status = 'completed' AND EXISTS (
        SELECT 1 FROM milestone_tasks WHERE milestone_id = NEW.id AND NOT is_done) THEN
        RAISE EXCEPTION 'Milestone % cannot be completed until all its tasks are done', NEW.sequence
            USING ERRCODE = 'check_violation';
    END IF;

    IF NEW.status = 'in_progress' THEN
        busy := find_busy_employee(
            ARRAY(SELECT user_id FROM milestone_assignments
                  WHERE milestone_id = NEW.id AND finished_at IS NULL), NEW.id);
        IF busy IS NOT NULL THEN
            RAISE EXCEPTION 'Employee % already has an active milestone', busy
                USING ERRCODE = 'check_violation';
        END IF;
    END IF;
    RETURN NEW;
END $$;

CREATE OR REPLACE TRIGGER milestones_check BEFORE INSERT OR UPDATE ON milestones
FOR EACH ROW EXECUTE FUNCTION check_milestone();

CREATE OR REPLACE FUNCTION check_milestone_task() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    NEW.done_at := CASE WHEN NEW.is_done THEN coalesce(NEW.done_at, now()) END;
    IF NOT NEW.is_done AND EXISTS (
        SELECT 1 FROM milestones WHERE id = NEW.milestone_id AND status = 'completed') THEN
        RAISE EXCEPTION 'Reopen milestone % before adding or reopening its tasks', NEW.milestone_id
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END $$;

CREATE OR REPLACE TRIGGER milestone_tasks_check BEFORE INSERT OR UPDATE ON milestone_tasks
FOR EACH ROW EXECUTE FUNCTION check_milestone_task();

CREATE OR REPLACE FUNCTION check_milestone_assignment() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    busy varchar;
BEGIN
    IF NEW.finished_at IS NULL
       AND EXISTS (SELECT 1 FROM milestones WHERE id = NEW.milestone_id AND status = 'in_progress') THEN
        busy := find_busy_employee(ARRAY[NEW.user_id], NEW.milestone_id);
        IF busy IS NOT NULL THEN
            RAISE EXCEPTION 'Employee % already has an active milestone', busy
                USING ERRCODE = 'check_violation';
        END IF;
    END IF;
    RETURN NEW;
END $$;

CREATE OR REPLACE TRIGGER milestone_assignments_check BEFORE INSERT OR UPDATE ON milestone_assignments
FOR EACH ROW EXECUTE FUNCTION check_milestone_assignment();
"""


class MilestoneCreate(BaseModel):
    """Managers: add a milestone. Sequence decides the order it runs in."""

    sequence: int = Field(gt=0)
    title: str = Field(min_length=1, max_length=200)
    description: str | None = None
    start_date: date
    end_date: date

    @model_validator(mode="after")
    def check_dates(self):
        """Rejects an end date before the start date."""
        if self.end_date < self.start_date:
            raise ValueError("end_date must be on or after start_date")
        return self


class MilestoneUpdate(BaseModel):
    """Managers and admins: change a milestone's details or status. Only the fields sent are changed."""

    title: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = None
    start_date: date | None = None
    end_date: date | None = None
    status: MilestoneStatus | None = None


class Milestone(BaseModel):
    """A milestone (deliverable) of a project."""

    id: int
    project_id: int
    sequence: int
    title: str
    description: str | None
    start_date: date
    end_date: date
    status: MilestoneStatus
    completed_at: datetime | None
    created_at: datetime
    updated_at: datetime


class MilestoneTaskCreate(BaseModel):
    """A new task on a milestone."""

    title: str = Field(min_length=1, max_length=200)


class MilestoneTaskUpdate(BaseModel):
    """Rename a task (managers and admins) or tick it off."""

    title: str | None = Field(default=None, min_length=1, max_length=200)
    is_done: bool | None = None


class MilestoneTask(BaseModel):
    """A task on a milestone, with who ticked it off and when."""

    id: int
    milestone_id: int
    title: str
    is_done: bool
    done_at: datetime | None
    done_by: str | None
    created_at: datetime
    updated_at: datetime


class MilestoneAssignmentCreate(BaseModel):
    """Assign a project member to a milestone."""

    user_id: str = Field(pattern=r"^[A-Za-z0-9]{6}$")


class MilestoneAssignmentUpdate(BaseModel):
    """Marks an employee's part of a milestone finished (or not), freeing them for another."""

    finished: bool


class MilestoneAssignment(BaseModel):
    """An employee assigned to a milestone; finished_at is set once their part is done."""

    id: int
    milestone_id: int
    project_id: int
    user_id: str
    assigned_at: datetime
    finished_at: datetime | None
