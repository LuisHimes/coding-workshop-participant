"""
Audit model: who did what, and when.

Every insert, update and delete on the audited tables is recorded by a
trigger, so nothing can change without leaving a trace. The acting user is
read from the "app.user_id" session setting, which the API sets for each
request with AuditRepository.set_actor(). Updates record only the changed fields,
and password hashes are never written to the log.

Services can also record events that are not row changes, such as LOGIN,
with AuditRepository.record_event().
"""

from datetime import datetime
from typing import Any

from pydantic import BaseModel

AUDITED_TABLES = [
    "users",
    "projects",
    "project_members",
    "milestones",
    "milestone_tasks",
    "milestone_assignments",
    "time_entries",
    "messages",
    "teams",
    "team_members",
]

SCHEMA = """
CREATE TABLE IF NOT EXISTS audit_log (
    id          BIGSERIAL PRIMARY KEY,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    actor_id    VARCHAR(6) REFERENCES users (id),
    action      TEXT NOT NULL,
    entity      TEXT NOT NULL,
    entity_id   TEXT,
    changes     JSONB
);

CREATE INDEX IF NOT EXISTS audit_log_entity_time_idx ON audit_log (entity, entity_id, occurred_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS audit_log_actor_time_idx ON audit_log (actor_id, occurred_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS audit_log_occurred_at_idx ON audit_log (occurred_at DESC);

CREATE OR REPLACE FUNCTION audit_row() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    old_row jsonb := CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END;
    new_row jsonb := CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END;
    changes jsonb;
BEGIN
    IF TG_OP = 'UPDATE' THEN
        SELECT jsonb_object_agg(key, jsonb_build_object('old', old_row -> key, 'new', value))
        INTO changes
        FROM jsonb_each(new_row - 'password_hash' - 'updated_at')
        WHERE old_row -> key IS DISTINCT FROM value;
        IF old_row -> 'password_hash' IS DISTINCT FROM new_row -> 'password_hash' THEN
            changes := coalesce(changes, '{}'::jsonb) || '{"password": "changed"}'::jsonb;
        END IF;
        IF changes IS NULL THEN
            RETURN NULL;
        END IF;
    END IF;

    INSERT INTO audit_log (actor_id, action, entity, entity_id, changes)
    VALUES (
        nullif(current_setting('app.user_id', true), ''),
        TG_OP,
        TG_TABLE_NAME,
        coalesce(new_row, old_row) ->> 'id',
        coalesce(changes, new_row - 'password_hash', old_row - 'password_hash')
    );
    RETURN NULL;
END $$;
""" + "\n".join(
    f"CREATE OR REPLACE TRIGGER {table}_audit AFTER INSERT OR UPDATE OR DELETE ON {table} "
    f"FOR EACH ROW EXECUTE FUNCTION audit_row();"
    for table in AUDITED_TABLES
)


class AuditEntry(BaseModel):
    id: int
    occurred_at: datetime
    actor_id: str | None
    action: str
    entity: str
    entity_id: str | None
    changes: dict[str, Any] | None
