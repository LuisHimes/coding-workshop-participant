"""
User routes. Permissions are checked in UserService.
"""

from typing import Literal

from fastapi import APIRouter, status

from dependencies import CurrentUser, UserServiceDep
from models.users import User, UserCreate, UserCreated, UserUpdate, UserWithSalary

router = APIRouter(prefix="/users", tags=["users"])


@router.get("")
def list_users(user: CurrentUser, users: UserServiceDep, role: Literal["admin", "manager", "employee"] | None = None,
               manager_id: str | None = None, q: str | None = None,
               include_inactive: bool = False) -> list[UserWithSalary | User]:
    """Search users by name, email or ID. Employees don't see salaries."""
    return users.list_users(user, role=role, manager_id=manager_id, q=q, include_inactive=include_inactive)


@router.post("", status_code=status.HTTP_201_CREATED)
def create_user(body: UserCreate, user: CurrentUser, users: UserServiceDep) -> UserCreated:
    """Admin-only. Returns the generated user ID and temporary password; pass them on to the user."""
    return users.create_user(user, body)


@router.get("/{user_id}")
def get_user(user_id: str, user: CurrentUser, users: UserServiceDep) -> UserWithSalary | User:
    """A user you are allowed to see. Employees don't see salaries."""
    return users.get_user(user, user_id)


@router.patch("/{user_id}")
def update_user(user_id: str, body: UserUpdate, user: CurrentUser, users: UserServiceDep) -> UserWithSalary:
    """Admin-only: role, job title, salary, manager, details or active status."""
    return users.update_user(user, user_id, body)


@router.post("/{user_id}/reset-password")
def reset_password(user_id: str, user: CurrentUser, users: UserServiceDep) -> UserCreated:
    """Admin-only: issues a new temporary password, which the user must change at next login."""
    return users.reset_password(user, user_id)
