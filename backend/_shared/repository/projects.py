"""
Project and project member data access.
"""

from models.projects import SEARCH_TEXT
from repository.base import Repository, where

MEMBER_COLUMNS = ["id", "project_id", "user_id", "hours_per_week", "assigned_by", "assigned_at"]


class ProjectRepository(Repository):
    table = "projects"
    columns = [
        "id", "name", "description", "manager_id", "status", "start_date", "projected_end_date",
        "allocated_hours", "budget", "archived_at", "archived_by", "archive_reason", "created_at", "updated_at",
    ]

    def create(self, values: dict) -> dict:
        return self._insert(values)

    def get(self, project_id: int) -> dict | None:
        return self._get(project_id)

    def find(self, archived: bool | None = False, manager_id: str | None = None, member_id: str | None = None,
             status: str | None = None, q: str | None = None) -> list[dict]:
        """
        Lists projects. archived=False (default) hides archived projects, True shows
        only archived ones, None shows both. member_id limits to an employee's projects.
        """
        conditions, params = [], []
        if archived is not None:
            conditions.append("archived_at IS NOT NULL" if archived else "archived_at IS NULL")
        if manager_id:
            conditions.append("manager_id = %s")
            params.append(manager_id)
        if member_id:
            conditions.append("id IN (SELECT project_id FROM project_members WHERE user_id = %s)")
            params.append(member_id)
        if status:
            conditions.append("status = %s")
            params.append(status)
        if q:
            conditions.append(f"{SEARCH_TEXT} ILIKE %s")
            params.append(f"%{q}%")
        return self.db.execute(
            f"SELECT {self._select()} FROM projects{where(conditions)} ORDER BY start_date DESC, id DESC", params
        ).fetchall()

    def update(self, project_id: int, values: dict) -> dict | None:
        return self._update(project_id, values)

    def archive(self, project_id: int, reason: str, archived_by: str) -> dict | None:
        """Archives a project; reason is 'deleted' or 'completed'."""
        return self.db.execute(
            f"UPDATE projects SET archived_at = now(), archive_reason = %s, archived_by = %s "
            f"WHERE id = %s RETURNING {self._select()}",
            (reason, archived_by, project_id),
        ).fetchone()

    def unarchive(self, project_id: int) -> dict | None:
        return self.db.execute(
            f"UPDATE projects SET archived_at = NULL, archive_reason = NULL, archived_by = NULL "
            f"WHERE id = %s RETURNING {self._select()}",
            (project_id,),
        ).fetchone()

    # Members

    def add_member(self, project_id: int, user_id: str, hours_per_week, assigned_by: str | None) -> dict:
        return self._insert({
            "project_id": project_id, "user_id": user_id,
            "hours_per_week": hours_per_week, "assigned_by": assigned_by,
        }, "project_members", MEMBER_COLUMNS)

    def members_of(self, project_id: int) -> list[dict]:
        return self.db.execute(
            f"SELECT {self._select(MEMBER_COLUMNS)} FROM project_members WHERE project_id = %s ORDER BY assigned_at",
            (project_id,),
        ).fetchall()

    def is_member(self, project_id: int, user_id: str) -> bool:
        return self.db.execute(
            "SELECT EXISTS (SELECT 1 FROM project_members WHERE project_id = %s AND user_id = %s) AS member",
            (project_id, user_id),
        ).fetchone()["member"]

    def update_member_hours(self, project_id: int, user_id: str, hours_per_week) -> dict | None:
        return self.db.execute(
            f"UPDATE project_members SET hours_per_week = %s WHERE project_id = %s AND user_id = %s "
            f"RETURNING {self._select(MEMBER_COLUMNS)}",
            (hours_per_week, project_id, user_id),
        ).fetchone()

    def remove_member(self, project_id: int, user_id: str) -> bool:
        """Removes an employee from a project, along with their milestone assignments in it."""
        return self.db.execute(
            "DELETE FROM project_members WHERE project_id = %s AND user_id = %s", (project_id, user_id)
        ).rowcount > 0
