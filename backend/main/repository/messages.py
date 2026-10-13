"""
Message board data access.
"""

from repository.base import Repository


class MessageRepository(Repository):
    table = "messages"
    columns = ["id", "project_id", "author_id", "body", "created_at"]

    def create(self, author_id: str, body: str, project_id: int | None = None) -> dict:
        return self._insert({"author_id": author_id, "body": body, "project_id": project_id})

    def get(self, message_id: int) -> dict | None:
        return self._get(message_id)

    def recent(self, project_ids: list[int] | None = None, limit: int = 50,
               include_announcements: bool = True) -> list[dict]:
        """
        Lists the newest messages: global ones plus those of the given projects.
        project_ids=None returns messages from every project (for admins);
        include_announcements=False leaves out the global ones.
        """
        if project_ids is None:
            condition, params = "", []
        else:
            announcements = "project_id IS NULL OR " if include_announcements else ""
            condition, params = f" WHERE {announcements}project_id = ANY(%s)", [project_ids]
        return self.db.execute(
            f"SELECT {self._select()} FROM messages{condition} ORDER BY created_at DESC, id DESC LIMIT %s",
            [*params, limit],
        ).fetchall()

    def delete(self, message_id: int) -> bool:
        return self._delete(message_id)
