"""
User management.

- Admins create users of any role (including other admins), edit them,
  deactivate them and reset their passwords. The system generates each user's
  6-character ID and, unless the admin supplies one, a temporary password.
- Every employee reports to one active manager.
- Users update only their own name and email; job title, salary, role and
  manager are admin-only.
- Salaries are visible to managers and admins, never to employees.
- Admins see everyone. Managers see themselves and employees (not other
  managers or admins). Employees see only themselves, their manager, their
  teammates and their projects' managers.
"""

import secrets

from models.users import User, UserCreate, UserCreated, UserSelfUpdate, UserUpdate, UserWithSalary
from repositories.users import UserRepository
from services.base import is_admin, is_employee, is_manager, require_role
from services.errors import ConflictError, InvalidRequestError, NotFoundError, database_rules
from services.security import hash_password


def present_user(actor: dict, user: dict) -> User | UserWithSalary:
    """The user as the actor may see them: employees never see salaries."""
    return User.model_validate(user) if is_employee(actor) else UserWithSalary.model_validate(user)


def generate_temporary_password() -> str:
    """A random password for a new user or a reset; the user must change it at next login."""
    return secrets.token_urlsafe(12)


def require_active_manager(users: UserRepository, manager_id: str | None) -> str:
    """Returns the manager's ID (uppercased) if it names an active manager."""
    manager = users.get(manager_id.upper()) if manager_id else None
    if manager is None or manager["role"] != "manager" or not manager["is_active"]:
        raise InvalidRequestError("manager_id must be an active manager")
    return manager["id"]


class UserService:
    """Manages users and decides who may see whom, and whose salary."""

    def __init__(self, users: UserRepository):
        self.users = users

    def create_user(self, actor: dict, data: UserCreate) -> UserCreated:
        """Admin-only: creates a user with a temporary password, returned once in the response."""
        require_role(actor, "admin")
        values = data.model_dump(exclude={"temporary_password"})
        if data.role == "employee":
            values["manager_id"] = require_active_manager(self.users, data.manager_id)
        temporary_password = data.temporary_password or generate_temporary_password()
        with database_rules():
            user = self.users.create({
                **values, "password_hash": hash_password(temporary_password), "must_change_password": True,
            })
        return UserCreated(user=UserWithSalary.model_validate(user), temporary_password=temporary_password)

    def get_user(self, actor: dict, user_id: str) -> User | UserWithSalary:
        """The user, if the actor may see them (see the module docstring); salary is hidden from employees."""
        user_id = user_id.upper()
        if is_employee(actor) and user_id not in self.users.contacts_of(actor["id"]):
            raise NotFoundError("User not found")
        user = self.users.get(user_id)
        if user is None or not self._manager_can_see(actor, user):
            raise NotFoundError("User not found")
        return present_user(actor, user)

    def list_users(self, actor: dict, role: str | None = None, manager_id: str | None = None,
                   q: str | None = None, include_inactive: bool = False) -> list[User | UserWithSalary]:
        """Search and filter users. Only admins see deactivated users."""
        ids = self.users.contacts_of(actor["id"]) if is_employee(actor) else None
        rows = self.users.find(role=role, manager_id=manager_id.upper() if manager_id else None, q=q,
                               include_inactive=include_inactive and is_admin(actor), ids=ids)
        return [present_user(actor, row) for row in rows if self._manager_can_see(actor, row)]

    def update_user(self, actor: dict, user_id: str, data: UserUpdate) -> UserWithSalary:
        """Admin-only: change role, job title, salary, manager, details or active status."""
        require_role(actor, "admin")
        user_id = user_id.upper()
        user = self.users.get(user_id)
        if user is None:
            raise NotFoundError("User not found")
        values = data.model_dump(exclude_unset=True)
        role = values.get("role", user["role"])
        if user_id == actor["id"] and (role != "admin" or values.get("is_active") is False):
            raise ConflictError("You can't deactivate yourself or remove your own admin role")

        if role == "employee":
            manager_id = values.get("manager_id", user["manager_id"])
            if not manager_id:
                raise InvalidRequestError("Employees must be assigned to a manager")
            values["manager_id"] = require_active_manager(self.users, manager_id)
            if values.get("salary", user["salary"]) is None:
                raise InvalidRequestError("Employees must have a salary")
        else:
            values["manager_id"] = None  # only employees report to a manager
        with database_rules():
            return UserWithSalary.model_validate(self.users.update(user_id, values))

    def update_self(self, actor: dict, data: UserSelfUpdate) -> User | UserWithSalary:
        """Any user: change their own name and email."""
        with database_rules():
            user = self.users.update(actor["id"], data.model_dump(exclude_unset=True))
        return present_user(actor, user)

    def reset_password(self, actor: dict, user_id: str) -> UserCreated:
        """Admin-only: give a user a new temporary password, which they must change at next login."""
        require_role(actor, "admin")
        user = self.users.get(user_id.upper())
        if user is None:
            raise NotFoundError("User not found")
        temporary_password = generate_temporary_password()
        self.users.set_password(user["id"], hash_password(temporary_password), must_change_password=True)
        user = self.users.get(user["id"])
        return UserCreated(user=UserWithSalary.model_validate(user), temporary_password=temporary_password)

    @staticmethod
    def _manager_can_see(actor: dict, user: dict) -> bool:
        """Managers see themselves and employees only; other roles aren't limited here."""
        return not is_manager(actor) or user["id"] == actor["id"] or user["role"] == "employee"
