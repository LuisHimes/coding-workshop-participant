"""
Audit log route. Admins only (checked in AuditService).
"""

from datetime import datetime

from fastapi import APIRouter, Query

from dependencies import AuditServiceDep, CurrentUser
from models.audit import AuditEntry

router = APIRouter(prefix="/audit", tags=["audit"])


@router.get("")
def audit_log(user: CurrentUser, audit: AuditServiceDep, entity: str | None = None, entity_id: str | None = None,
              actor_id: str | None = None, since: datetime | None = None,
              limit: int = Query(default=100, ge=1, le=1000)) -> list[AuditEntry]:
    """What was done, by whom, and when; newest first. Filter by table (entity), record, user or time."""
    return audit.list_entries(user, entity=entity, entity_id=entity_id, actor_id=actor_id, since=since, limit=limit)
