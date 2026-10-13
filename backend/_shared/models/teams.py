"""
Team model: named groups of a manager's direct reports, used to staff
projects in one step and to filter resource reports.

Rules enforced by PostgreSQL:
- A team belongs to one manager (composite foreign key on the manager's role,
  as for projects), and its names are unique per manager.
- Members must be employees who report to the team's manager.
- When an employee's manager changes, or they stop being an employee, they
  are removed from their previous manager's teams.
"""

from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, Field

from models.base import HOURS_PER_WEEK, updated_at_trigger
from models.projects import ProjectMemberAllocation

SCHEMA = f"""
CREATE TABLE IF NOT EXISTS teams (
    id           SERIAL PRIMARY KEY,
    name         VARCHAR(200) NOT NULL CHECK (name <> ''),
    description  TEXT,
    manager_id   VARCHAR(6) NOT NULL,
    manager_role TEXT GENERATED ALWAYS AS ('manager') STORED,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    FOREIGN KEY (manager_id, manager_role) REFERENCES users (id, role)
);

CREATE UNIQUE INDEX IF NOT EXISTS teams_manager_name_key ON teams (manager_id, lower(name));
{updated_at_trigger("teams")}

CREATE TABLE IF NOT EXISTS team_members (
    id       SERIAL PRIMARY KEY,
    team_id  INTEGER NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
    user_id  VARCHAR(6) NOT NULL REFERENCES users (id),
    added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (team_id, user_id)
);

CREATE INDEX IF NOT EXISTS team_members_user_id_idx ON team_members (user_id);

CREATE OR REPLACE FUNCTION check_team_member() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM users u JOIN teams t ON t.id = NEW.team_id
        WHERE u.id = NEW.user_id AND u.role = 'employee' AND u.manager_id = t.manager_id) THEN
        RAISE EXCEPTION 'Employee % does not report to this team''s manager', NEW.user_id
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END $$;

CREATE OR REPLACE TRIGGER team_members_check BEFORE INSERT OR UPDATE ON team_members
FOR EACH ROW EXECUTE FUNCTION check_team_member();

-- Moving an employee to another manager takes them off the old manager's teams
CREATE OR REPLACE FUNCTION remove_stale_team_memberships() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    DELETE FROM team_members tm USING teams t
    WHERE tm.team_id = t.id AND tm.user_id = NEW.id AND t.manager_id IS DISTINCT FROM NEW.manager_id;
    RETURN NULL;
END $$;

CREATE OR REPLACE TRIGGER users_team_memberships AFTER UPDATE OF manager_id, role ON users
FOR EACH ROW WHEN (OLD.manager_id IS DISTINCT FROM NEW.manager_id)
EXECUTE FUNCTION remove_stale_team_memberships();
"""


class TeamCreate(BaseModel):
    """Managers create teams for themselves; admins must say which manager the team belongs to."""

    name: str = Field(min_length=1, max_length=200)
    description: str | None = None
    manager_id: str | None = Field(default=None, pattern=r"^[A-Za-z0-9]{6}$")


class TeamUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = None


class Team(BaseModel):
    id: int
    name: str
    description: str | None
    manager_id: str
    member_count: int
    created_at: datetime
    updated_at: datetime


class TeamMemberCreate(BaseModel):
    user_id: str = Field(pattern=r"^[A-Za-z0-9]{6}$")


class TeamMember(BaseModel):
    team_id: int
    user_id: str
    first_name: str
    last_name: str
    job_title: str
    is_active: bool
    added_at: datetime


class TeamProjectAssignment(BaseModel):
    """Adds every active member of a team to a project with the same weekly hours."""

    team_id: int
    hours_per_week: Decimal = Field(default=Decimal(HOURS_PER_WEEK), gt=0, le=HOURS_PER_WEEK)


class SkippedMember(BaseModel):
    user_id: str
    reason: str


class TeamStaffingResult(BaseModel):
    added: list[ProjectMemberAllocation]
    skipped: list[SkippedMember]
