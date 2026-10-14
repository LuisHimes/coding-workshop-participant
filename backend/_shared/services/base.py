"""
Shared helpers for services.

Every service method takes the acting user (the dict CurrentUser provides) as
its first argument and checks permissions itself, so the rules hold no matter
which controller calls it.
"""

from services.errors import PermissionDeniedError


def is_admin(actor: dict) -> bool:
    """Whether the actor is an admin."""
    return actor["role"] == "admin"


def is_manager(actor: dict) -> bool:
    """Whether the actor is a manager."""
    return actor["role"] == "manager"


def is_employee(actor: dict) -> bool:
    """Whether the actor is an employee."""
    return actor["role"] == "employee"


def require_role(actor: dict, *roles: str) -> None:
    """Raises PermissionDeniedError unless the actor has one of the given roles."""
    if actor["role"] not in roles:
        raise PermissionDeniedError("You do not have permission to do this")
