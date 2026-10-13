"""
Reading the audit log: what was done, by whom, and when. Admins only.
Entries are written automatically by database triggers and login events.
"""

from datetime import datetime

from models.audit import AuditEntry
from repository.audit import AuditRepository
from service.base import require_role


class AuditService:
    def __init__(self, audit: AuditRepository):
        self.audit = audit

    def list_entries(self, actor: dict, entity: str | None = None, entity_id: str | None = None,
                     actor_id: str | None = None, since: datetime | None = None,
                     limit: int = 100) -> list[AuditEntry]:
        require_role(actor, "admin")
        rows = self.audit.find(entity=entity, entity_id=entity_id, actor_id=actor_id.upper() if actor_id else None,
                               since=since, limit=min(limit, 1000))
        return [AuditEntry.model_validate(row) for row in rows]
