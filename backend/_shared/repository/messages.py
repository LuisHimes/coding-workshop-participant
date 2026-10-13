"""
Message board data access. Messages come with their author's name, so readers
can see who posted even when they can't look that person up (a manager reading
posts left by a project's previous manager, for example).
"""

from repository.base import Repository

SELECT = (
    "SELECT m.id, m.project_id, m.author_id, u.first_name || ' ' || u.last_name AS author_name, m.body, m.created_at "
    "FROM messages m JOIN users u ON u.id = m.author_id"
)


class MessageRepository(Repository):
    table = "messages"
    columns = ["id", "project_id", "author_id", "body", "created_at"]

    def create(self, author_id: str, body: str, project_id: int | None = None) -> dict:
        return self.get(self._insert({"author_id": author_id, "body": body, "project_id": project_id})["id"])

    def get(self, message_id: int) -> dict | None:
        return self.db.execute(f"{SELECT} WHERE m.id = %s", (message_id,)).fetchone()

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
            announcements = "m.project_id IS NULL OR " if include_announcements else ""
            condition, params = f" WHERE {announcements}m.project_id = ANY(%s)", [project_ids]
        return self.db.execute(
            f"{SELECT}{condition} ORDER BY m.created_at DESC, m.id DESC LIMIT %s", [*params, limit],
        ).fetchall()

    def delete(self, message_id: int) -> bool:
        return self._delete(message_id)
