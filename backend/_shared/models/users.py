"""
User model: admins, managers and employees.

Users are identified by a 6-character ID, which is also their login username.
Employees must report to exactly one manager. A composite foreign key on
(manager_id, manager_role) -> users(id, role) makes PostgreSQL guarantee that
the referenced user really is a manager, and blocks changing the role of a
manager who still has employees. Users are deactivated, never deleted, so the
audit trail stays intact.
"""

from datetime import datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field, model_validator

from models.base import updated_at_trigger

Role = Literal["admin", "manager", "employee"]

USER_ID_PATTERN = r"^[A-Z0-9]{6}$"

# What user search matches against. The trigram index is built on exactly this
# expression, so repository queries must use it unchanged to hit the index.
SEARCH_TEXT = "(first_name || ' ' || last_name || ' ' || email || ' ' || id)"
EMAIL_PATTERN = r"^[^@\s]+@[^@\s]+\.[^@\s]+$"

SCHEMA = rf"""
-- Random 6-character ID without look-alike characters (0/O, 1/I)
CREATE OR REPLACE FUNCTION generate_user_id() RETURNS varchar LANGUAGE plpgsql AS $$
DECLARE
    chars CONSTANT text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    candidate varchar(6);
BEGIN
    LOOP
        candidate := '';
        FOR i IN 1..6 LOOP
            candidate := candidate || substr(chars, 1 + floor(random() * length(chars))::int, 1);
        END LOOP;
        EXIT WHEN NOT EXISTS (SELECT 1 FROM users WHERE id = candidate);
    END LOOP;
    RETURN candidate;
END $$;

CREATE TABLE IF NOT EXISTS users (
    id                   VARCHAR(6) PRIMARY KEY DEFAULT generate_user_id()
                         CHECK (id ~ '{USER_ID_PATTERN}'),
    role                 TEXT NOT NULL CHECK (role IN ('admin', 'manager', 'employee')),
    first_name           VARCHAR(100) NOT NULL CHECK (first_name <> ''),
    last_name            VARCHAR(100) NOT NULL CHECK (last_name <> ''),
    email                VARCHAR(255) NOT NULL CHECK (email ~ '{EMAIL_PATTERN}'),
    password_hash        TEXT NOT NULL,
    must_change_password BOOLEAN NOT NULL DEFAULT true,
    job_title            VARCHAR(100) NOT NULL,
    salary               NUMERIC(12, 2) CHECK (salary >= 0),
    manager_id           VARCHAR(6),
    manager_role         TEXT GENERATED ALWAYS AS (CASE WHEN manager_id IS NOT NULL THEN 'manager' END) STORED,
    is_active            BOOLEAN NOT NULL DEFAULT true,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (id, role),
    FOREIGN KEY (manager_id, manager_role) REFERENCES users (id, role),
    -- Employees, and only employees, report to a manager
    CHECK ((role = 'employee') = (manager_id IS NOT NULL)),
    -- Employee salaries drive project budgets, so they are required
    CHECK (role <> 'employee' OR salary IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS users_email_key ON users (lower(email));
CREATE INDEX IF NOT EXISTS users_manager_id_idx ON users (manager_id);
CREATE INDEX IF NOT EXISTS users_search_idx ON users USING gin ({SEARCH_TEXT} public.gin_trgm_ops);
{updated_at_trigger("users")}
"""


class UserCreate(BaseModel):
    """Admin-only: create a user. The system generates the 6-character user ID."""

    role: Role
    first_name: str = Field(min_length=1, max_length=100)
    last_name: str = Field(min_length=1, max_length=100)
    email: str = Field(pattern=EMAIL_PATTERN, max_length=255)
    job_title: str = Field(min_length=1, max_length=100)
    salary: Decimal | None = Field(default=None, ge=0, max_digits=12, decimal_places=2)
    manager_id: str | None = Field(default=None, pattern=r"^[A-Za-z0-9]{6}$")
    temporary_password: str | None = Field(default=None, min_length=8, description="Generated when omitted")

    @model_validator(mode="after")
    def check_employee_fields(self):
        """Employees need a manager and a salary; other roles can't have a manager."""
        if self.role == "employee" and (self.manager_id is None or self.salary is None):
            raise ValueError("employees require a manager_id and a salary")
        if self.role != "employee" and self.manager_id is not None:
            raise ValueError("only employees can be assigned a manager")
        return self


class UserUpdate(BaseModel):
    """Admin-only: change any user field except the password."""

    role: Role | None = None
    first_name: str | None = Field(default=None, min_length=1, max_length=100)
    last_name: str | None = Field(default=None, min_length=1, max_length=100)
    email: str | None = Field(default=None, pattern=EMAIL_PATTERN, max_length=255)
    job_title: str | None = Field(default=None, min_length=1, max_length=100)
    salary: Decimal | None = Field(default=None, ge=0, max_digits=12, decimal_places=2)
    manager_id: str | None = Field(default=None, pattern=r"^[A-Za-z0-9]{6}$")
    is_active: bool | None = None


class UserSelfUpdate(BaseModel):
    """Any user: the personal details they are allowed to change themselves."""

    first_name: str | None = Field(default=None, min_length=1, max_length=100)
    last_name: str | None = Field(default=None, min_length=1, max_length=100)
    email: str | None = Field(default=None, pattern=EMAIL_PATTERN, max_length=255)


class PasswordChange(BaseModel):
    """Replaces a temporary password with a permanent one."""

    current_password: str
    new_password: str = Field(min_length=8)


class User(BaseModel):
    """User as seen by employees: no salary."""

    id: str
    role: Role
    first_name: str
    last_name: str
    email: str
    job_title: str
    manager_id: str | None
    is_active: bool
    must_change_password: bool
    created_at: datetime
    updated_at: datetime


class UserWithSalary(User):
    """User as seen by managers and admins."""

    salary: Decimal | None


class UserCreated(BaseModel):
    """A new user and their temporary password, shown once so the admin can pass it on."""

    user: UserWithSalary
    temporary_password: str
