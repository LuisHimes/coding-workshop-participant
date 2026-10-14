"""
Errors raised by the service layer. Messages are written for the end user.

middleware.py turns them into HTTP responses, so controllers don't need to catch them:
NotFoundError 404, PermissionDeniedError 403, ConflictError 409,
InvalidRequestError 400.
"""

from contextlib import contextmanager

from psycopg import errors as pg_errors


class ServiceError(Exception):
    """Base class for service errors; message is shown to the user as the response's detail."""

    def __init__(self, message: str):
        super().__init__(message)
        self.message = message


class NotFoundError(ServiceError):
    """The record does not exist, or the user is not allowed to know it exists."""


class PermissionDeniedError(ServiceError):
    """The user is logged in but their role does not allow this."""


class ConflictError(ServiceError):
    """The request clashes with the current state, e.g. a business rule the database enforces."""


class InvalidRequestError(ServiceError):
    """The request is well-formed but its values don't make sense together."""


@contextmanager
def database_rules():
    """
    Turns PostgreSQL rule violations into service errors. The trigger messages
    (e.g. "Employee ABC123 already has an active milestone") are already
    written for people, so they are passed through.
    """
    try:
        yield
    except pg_errors.UniqueViolation as e:
        raise ConflictError(_unique_message(e)) from e
    except pg_errors.ForeignKeyViolation as e:
        raise ConflictError("A referenced record does not exist, or has the wrong role for this") from e
    except pg_errors.CheckViolation as e:
        raise ConflictError(e.diag.message_primary or "This change breaks a project rule") from e


def _unique_message(error: pg_errors.UniqueViolation) -> str:
    constraint = error.diag.constraint_name or ""
    if "email" in constraint:
        return "That email address is already in use"
    if "project_members" in constraint:
        return "That employee is already on this project"
    if "milestone_assignments" in constraint:
        return "That employee is already assigned to this milestone"
    if "teams_manager_name" in constraint:
        return "This manager already has a team with that name"
    if "milestone_templates_manager_name" in constraint:
        return "This manager already has a milestone template with that name"
    if "team_members" in constraint:
        return "That employee is already on this team"
    if "sequence" in constraint:
        return "Another milestone in this project already has that sequence number"
    return "That record already exists"
