"""
User data access. Queries never return password_hash, except the
get_credentials* lookups, which exist only for checking passwords.
"""

from models.users import SEARCH_TEXT
from repositories.base import Repository, where


class UserRepository(Repository):
    """Reads and writes users. Only the get_credentials* lookups return password_hash."""

    table = "users"
    columns = [
        "id", "role", "first_name", "last_name", "email", "job_title", "salary", "manager_id",
        "is_active", "must_change_password", "created_at", "updated_at",
    ]

    def create(self, values: dict) -> dict:
        """Inserts a user. values must include password_hash; id is generated when omitted."""
        return self._insert(values)

    def get(self, user_id: str) -> dict | None:
        """Returns the user (active or not), or None."""
        return self._get(user_id)

    def get_credentials_by_email(self, email: str) -> dict | None:
        """Login lookup by email, ignoring case (uses the lower(email) index)."""
        return self.db.execute(
            "SELECT id, role, password_hash, must_change_password, is_active FROM users WHERE lower(email) = lower(%s)",
            (email,),
        ).fetchone()

    def get_credentials(self, user_id: str) -> dict | None:
        """Returns id, role, password_hash, must_change_password and is_active for a login check."""
        return self.db.execute(
            "SELECT id, role, password_hash, must_change_password, is_active FROM users WHERE id = %s",
            (user_id,),
        ).fetchone()

    def find(self, role: str | None = None, manager_id: str | None = None, q: str | None = None,
             include_inactive: bool = False, ids: list[str] | None = None) -> list[dict]:
        """Lists users, optionally filtered by role, manager, a name/email/ID search, or a list of IDs."""
        conditions, params = [], []
        if ids is not None:
            conditions.append("id = ANY(%s)")
            params.append(ids)
        if role:
            conditions.append("role = %s")
            params.append(role)
        if manager_id:
            conditions.append("manager_id = %s")
            params.append(manager_id)
        if q:
            conditions.append(f"{SEARCH_TEXT} ILIKE %s")
            params.append(f"%{q}%")
        if not include_inactive:
            conditions.append("is_active")
        return self.db.execute(
            f"SELECT {self._select()} FROM users{where(conditions)} ORDER BY last_name, first_name", params
        ).fetchall()

    def update(self, user_id: str, values: dict) -> dict | None:
        """Updates the given fields and returns the user, or None if it does not exist."""
        return self._update(user_id, values)

    def set_password(self, user_id: str, password_hash: str, must_change_password: bool) -> bool:
        """Stores a new password hash; must_change_password is True for temporary passwords."""
        return self.db.execute(
            "UPDATE users SET password_hash = %s, must_change_password = %s WHERE id = %s",
            (password_hash, must_change_password, user_id),
        ).rowcount > 0

    def contacts_of(self, employee_id: str) -> list[str]:
        """
        IDs an employee may see: themselves, their manager, their teammates on
        open projects, and those projects' managers.
        """
        rows = self.db.execute(
            """
            SELECT %(id)s::varchar AS id
            UNION SELECT manager_id FROM users WHERE id = %(id)s AND manager_id IS NOT NULL
            UNION SELECT other.user_id
                  FROM project_members mine
                  JOIN projects p ON p.id = mine.project_id AND p.archived_at IS NULL
                  JOIN project_members other ON other.project_id = mine.project_id
                  WHERE mine.user_id = %(id)s
            UNION SELECT p.manager_id
                  FROM project_members mine
                  JOIN projects p ON p.id = mine.project_id AND p.archived_at IS NULL
                  WHERE mine.user_id = %(id)s
            """,
            {"id": employee_id},
        ).fetchall()
        return [row["id"] for row in rows]
