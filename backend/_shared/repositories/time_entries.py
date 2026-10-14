"""
Time entry data access.
"""

from datetime import date

from repositories.base import Repository, where


class TimeEntryRepository(Repository):
    """Reads and writes the hours employees log."""

    table = "time_entries"
    columns = ["id", "user_id", "project_id", "milestone_id", "work_date", "hours", "description",
               "created_at", "updated_at"]

    def create(self, user_id: str, values: dict) -> dict:
        """Inserts an entry for the employee and returns it."""
        return self._insert({"user_id": user_id, **values})

    def get(self, entry_id: int) -> dict | None:
        """Returns the entry, or None."""
        return self._get(entry_id)

    def find(self, user_id: str | None = None, project_id: int | None = None, project_ids: list[int] | None = None,
             start: date | None = None, end: date | None = None) -> list[dict]:
        """Lists entries filtered by employee, project(s) and an inclusive date range."""
        conditions, params = [], []
        if project_ids is not None:
            conditions.append("project_id = ANY(%s)")
            params.append(project_ids)
        for condition, value in (("user_id = %s", user_id), ("project_id = %s", project_id),
                                 ("work_date >= %s", start), ("work_date <= %s", end)):
            if value is not None:
                conditions.append(condition)
                params.append(value)
        return self.db.execute(
            f"SELECT {self._select()} FROM time_entries{where(conditions)} ORDER BY work_date DESC, id DESC", params
        ).fetchall()

    def update(self, entry_id: int, values: dict) -> dict | None:
        """Updates the given fields and returns the entry, or None if it does not exist."""
        return self._update(entry_id, values)

    def delete(self, entry_id: int) -> bool:
        """Deletes an entry and returns whether it existed."""
        return self._delete(entry_id)
