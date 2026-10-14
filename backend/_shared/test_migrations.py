"""
Tests for schema migrations.

Each test runs in its own temporary schema (see the db fixture in conftest.py).
Run from the service folder: pytest
"""

import re
from datetime import date

import pytest
from psycopg import errors

from database import SCHEMA, SCHEMA_FINGERPRINT, create_schema, ensure_schema, migration_files, schema_fingerprint


def applied_versions(db) -> list[str]:
    return [row["version"] for row in db.execute("SELECT version FROM schema_migrations ORDER BY version")]


def test_migration_files_are_numbered_so_they_apply_in_order():
    names = [path.name for path in migration_files()]
    assert names, "expected at least one migration"
    assert all(re.fullmatch(r"\d{3}_[a-z0-9_]+\.sql", name) for name in names), names
    numbers = [name[:3] for name in names]
    assert len(set(numbers)) == len(numbers), "two migrations share a number"


def test_fresh_databases_record_every_migration_as_applied(db):
    assert applied_versions(db) == [path.stem for path in migration_files()]


def test_reapplying_the_schema_does_not_rerun_migrations(db):
    before = db.execute("SELECT version, applied_at FROM schema_migrations ORDER BY version").fetchall()
    create_schema(db)
    assert db.execute("SELECT version, applied_at FROM schema_migrations ORDER BY version").fetchall() == before


def stored(db):
    return db.execute("SELECT fingerprint FROM schema_state").fetchone()["fingerprint"]


def test_cold_starts_skip_the_schema_setup_when_nothing_changed(db):
    assert stored(db) == SCHEMA_FINGERPRINT
    # Drop a trigger the setup creates: a skipped setup leaves it missing
    db.execute("DROP TRIGGER projects_check ON projects")
    assert ensure_schema(db) is False
    assert db.execute("SELECT count(*) AS n FROM pg_trigger WHERE tgname = 'projects_check' AND tgrelid = 'projects'::regclass").fetchone()["n"] == 0
    # A forced setup recreates it
    assert create_schema(db) is True
    assert db.execute("SELECT count(*) AS n FROM pg_trigger WHERE tgname = 'projects_check' AND tgrelid = 'projects'::regclass").fetchone()["n"] == 1


def test_the_schema_setup_reruns_after_a_schema_change(db):
    db.execute("UPDATE schema_state SET fingerprint = 'from an older deploy'")
    assert ensure_schema(db) is True
    assert stored(db) == SCHEMA_FINGERPRINT
    assert ensure_schema(db) is False


def test_databases_from_before_fingerprints_get_one(db):
    db.execute("DROP TABLE schema_state")
    assert ensure_schema(db) is True
    assert stored(db) == SCHEMA_FINGERPRINT


def test_the_fingerprint_covers_the_schema_and_migrations(tmp_path):
    migration = tmp_path / "099_example.sql"
    migration.write_text("SELECT 1;")
    files = [*migration_files(), migration]
    assert schema_fingerprint(SCHEMA, migration_files()) == SCHEMA_FINGERPRINT
    assert schema_fingerprint(SCHEMA, files) != SCHEMA_FINGERPRINT
    with_edit = schema_fingerprint(SCHEMA, files)
    migration.write_text("SELECT 2;")
    assert schema_fingerprint(SCHEMA, files) != with_edit
    assert schema_fingerprint([*SCHEMA, "SELECT 1;"], migration_files()) != SCHEMA_FINGERPRINT


def make_project(db, status="planning", **archive):
    manager = db.execute(
        "INSERT INTO users (role, first_name, last_name, email, password_hash, job_title) "
        "VALUES ('manager', 'Mia', 'Manager', %s, 'hash', 'Manager') RETURNING id",
        (f"mia{db.execute('SELECT count(*) AS n FROM users').fetchone()['n']}@example.com",),
    ).fetchone()["id"]
    return db.execute(
        "INSERT INTO projects (name, manager_id, status, start_date, projected_end_date, allocated_hours, "
        "archived_at, archive_reason) VALUES ('P', %s, %s, %s, %s, 10, %s, %s) RETURNING id",
        (manager, status, date(2026, 1, 1), date(2026, 2, 1), archive.get("archived_at"), archive.get("reason")),
    ).fetchone()["id"]


def test_001_converts_closed_projects_and_removes_the_status(db):
    # Rebuild the schema as it was before 001: unnamed constraints allowing 'closed'
    db.execute("DELETE FROM schema_migrations WHERE version = '001_remove_closed_project_status'")
    db.execute("ALTER TABLE projects DROP CONSTRAINT projects_status_check, "
               "DROP CONSTRAINT projects_archive_reason_status_check")
    db.execute("ALTER TABLE projects ADD CHECK (status IN ('planning', 'active', 'completed', 'closed')), "
               "ADD CHECK (archive_reason IS DISTINCT FROM 'completed' OR status IN ('completed', 'closed'))")
    db.execute("ALTER TABLE projects DISABLE TRIGGER projects_check")  # closed projects predate the new rules
    closed = make_project(db, "closed", archived_at=date(2026, 3, 1), reason="completed")
    active = make_project(db, "active")
    db.execute("ALTER TABLE projects ENABLE TRIGGER projects_check")

    create_schema(db)

    statuses = {r["id"]: r["status"] for r in db.execute("SELECT id, status FROM projects")}
    assert statuses == {closed: "completed", active: "active"}
    assert "001_remove_closed_project_status" in applied_versions(db)
    audit = db.execute("SELECT changes FROM audit_log WHERE entity = 'projects' AND action = 'UPDATE'").fetchone()
    assert audit["changes"]["status"] == {"old": "closed", "new": "completed"}
    with pytest.raises(errors.CheckViolation):
        db.execute("UPDATE projects SET status = 'closed' WHERE id = %s", (active,))
    constraints = {r["conname"] for r in db.execute(
        "SELECT conname FROM pg_constraint WHERE conrelid = 'projects'::regclass AND contype = 'c' "
        "AND pg_get_constraintdef(oid) LIKE '%closed%'")}
    assert constraints == set()
