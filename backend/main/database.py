"""
PostgreSQL connection management, schema setup and migrations.

A module-level connection is reused across Lambda invocations within the same
container, improving performance and reducing cold start time. Broken
connections are discarded so the next request reconnects.

Schema changes:
- The models' SCHEMA SQL always describes the latest schema. A fresh database
  is built from it directly, and every migration is recorded as applied.
- Existing databases are brought up to date by the SQL files in migrations/,
  each applied once, in filename order, and recorded in schema_migrations.
  Pending migrations run before the models' SCHEMA, so views and functions
  are recreated against the migrated tables.
"""

import logging
from collections.abc import Iterator
from pathlib import Path

from psycopg import Connection, connect
from psycopg.rows import dict_row, tuple_row

from config import settings
from models import audit, base, dashboard, messages, milestones, projects, teams, time_entries, users
from repository.users import UserRepository
from service.auth import ensure_initial_admin

logger = logging.getLogger(__name__)

# Module-level PostgreSQL connection, persists between invocations
PG_CONN: Connection | None = None

# Schema SQL from each model, in dependency order. Every statement is
# idempotent, so the schema can be (re)applied on every cold start.
SCHEMA = [
    base.SCHEMA,
    users.SCHEMA,
    projects.SCHEMA,
    milestones.SCHEMA,
    time_entries.SCHEMA,
    messages.SCHEMA,
    teams.SCHEMA,
    audit.SCHEMA,
    dashboard.SCHEMA,
]

# Arbitrary key that serializes schema setup across concurrent cold starts
SCHEMA_LOCK_ID = 727274

MIGRATIONS_DIR = Path(__file__).parent / "migrations"

MIGRATIONS_TABLE = """
CREATE TABLE IF NOT EXISTS schema_migrations (
    version    TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
"""


def migration_files() -> list[Path]:
    """Migration files in the order they apply, e.g. 001_remove_closed_project_status.sql."""
    return sorted(MIGRATIONS_DIR.glob("*.sql"))


def create_schema(conn: Connection) -> None:
    """
    Creates or updates all tables, triggers and views, applying any pending
    migrations, in one all-or-nothing transaction.
    """
    with conn.transaction(), conn.cursor(row_factory=tuple_row) as cur:
        cur.execute("SELECT pg_advisory_xact_lock(%s)", (SCHEMA_LOCK_ID,))
        cur.execute("SELECT to_regclass('users') IS NULL")
        fresh = cur.fetchone()[0]
        cur.execute(MIGRATIONS_TABLE)
        cur.execute("SELECT version FROM schema_migrations")
        applied = {row[0] for row in cur.fetchall()}

        for path in migration_files():
            if path.stem in applied:
                continue
            if not fresh:
                logger.info("Applying migration %s", path.stem)
                cur.execute(path.read_text())
            cur.execute("INSERT INTO schema_migrations (version) VALUES (%s)", (path.stem,))

        for sql in SCHEMA:
            cur.execute(sql)


def get_connection() -> Connection:
    """Returns the pooled connection, creating it (and the schema) if needed."""
    global PG_CONN
    if PG_CONN is None or PG_CONN.closed:
        PG_CONN = connect(settings.pg_config, autocommit=True, row_factory=dict_row)
        create_schema(PG_CONN)
        # Under the same lock, so concurrent cold starts create the first admin only once
        with PG_CONN.transaction():
            PG_CONN.execute("SELECT pg_advisory_xact_lock(%s)", (SCHEMA_LOCK_ID,))
            ensure_initial_admin(UserRepository(PG_CONN))
    return PG_CONN


def get_db() -> Iterator[Connection]:
    """
    FastAPI dependency yielding the connection; resets it on database errors.
    The connection is reused across requests, so the audit actor is cleared
    first: an anonymous request must never be attributed to the previous user.
    """
    global PG_CONN
    try:
        conn = get_connection()
        conn.execute("SELECT set_config('app.user_id', '', false)")
        yield conn
    except Exception as e:
        # Drop a broken connection so the next request reconnects
        if PG_CONN is not None and PG_CONN.broken:
            logger.error("PostgreSQL connection lost: %s", e)
            PG_CONN = None
        raise
