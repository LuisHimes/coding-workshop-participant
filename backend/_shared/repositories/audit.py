"""
Audit log data access. Entries are written by triggers and record_event().
"""

import json
from datetime import datetime

from repositories.base import Repository, where


class AuditRepository(Repository):
    """Reads and writes the audit log."""

    table = "audit_log"
    columns = ["id", "occurred_at", "actor_id", "action", "entity", "entity_id", "changes"]

    def set_actor(self, user_id: str | None) -> None:
        """Records which user is acting, for the audit triggers. Call once per request."""
        self.db.execute("SELECT set_config('app.user_id', %s, false)", (user_id or "",))

    def record_event(self, action: str, entity: str, entity_id: str | None = None,
                     details: dict | None = None) -> None:
        """Adds an entry for an event that is not a row change, such as LOGIN."""
        self.db.execute(
            "INSERT INTO audit_log (actor_id, action, entity, entity_id, changes) "
            "VALUES (nullif(current_setting('app.user_id', true), ''), %s, %s, %s, %s)",
            (action, entity, entity_id, json.dumps(details) if details is not None else None),
        )

    def find(self, entity: str | None = None, entity_id: str | None = None, actor_id: str | None = None,
             since: datetime | None = None, limit: int = 100) -> list[dict]:
        """Lists the newest entries, filtered by what changed, who did it, and when."""
        conditions, params = [], []
        for condition, value in (("entity = %s", entity), ("entity_id = %s", entity_id),
                                 ("actor_id = %s", actor_id), ("occurred_at >= %s", since)):
            if value is not None:
                conditions.append(condition)
                params.append(value)
        return self.db.execute(
            f"SELECT {self._select()} FROM audit_log{where(conditions)} ORDER BY occurred_at DESC, id DESC LIMIT %s",
            [*params, limit],
        ).fetchall()
