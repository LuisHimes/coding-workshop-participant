"""
Tests that important queries can use their indexes.

Test tables are tiny, so the planner would scan them anyway; sequential scans
are switched off to check that a matching index exists for each query shape.
Each test runs in its own temporary schema (see the db fixture in conftest.py).
Run from the service folder: pytest
"""

import pytest

from database import create_schema
from models.projects import SEARCH_TEXT as PROJECT_SEARCH
from models.users import SEARCH_TEXT as USER_SEARCH

QUERIES = [
    ("users_search_idx", f"SELECT id FROM users WHERE {USER_SEARCH} ILIKE '%hopper%'"),
    ("projects_search_idx", f"SELECT id FROM projects WHERE {PROJECT_SEARCH} ILIKE '%servers%'"),
    ("milestone_assignments_project_user_idx", "SELECT * FROM milestone_assignments WHERE project_id = 1"),
    ("time_entries_project_date_idx",
     "SELECT * FROM time_entries WHERE project_id = ANY('{1,2}') AND work_date >= '2026-01-01' "
     "ORDER BY work_date DESC"),
    ("time_entries_milestone_id_idx", "SELECT 1 FROM time_entries WHERE milestone_id = 1"),
    ("messages_created_idx", "SELECT * FROM messages ORDER BY created_at DESC, id DESC LIMIT 50"),
    ("audit_log_entity_time_idx",
     "SELECT * FROM audit_log WHERE entity = 'projects' AND entity_id = '1' ORDER BY occurred_at DESC, id DESC LIMIT 100"),
    ("audit_log_actor_time_idx",
     "SELECT * FROM audit_log WHERE actor_id = 'ADA001' ORDER BY occurred_at DESC, id DESC LIMIT 100"),
]


@pytest.mark.parametrize("index, query", QUERIES, ids=[index for index, _ in QUERIES])
def test_query_can_use_its_index(db, index, query):
    db.execute("SET enable_seqscan = off")
    plan = "\n".join(row["QUERY PLAN"] for row in db.execute(f"EXPLAIN {query}"))
    assert index in plan, plan


def index_names(db, table: str) -> set[str]:
    return {r["indexname"] for r in db.execute("SELECT indexname FROM pg_indexes "
                                               "WHERE schemaname = current_schema() AND tablename = %s", (table,))}


def test_002_replaces_the_old_indexes(db):
    # Rebuild the index layout from before 002
    db.execute("DELETE FROM schema_migrations WHERE version = '002_add_search_and_lookup_indexes'")
    for index in ("users_search_idx", "projects_search_idx", "milestone_assignments_project_user_idx",
                  "time_entries_project_date_idx", "time_entries_milestone_id_idx", "messages_created_idx",
                  "audit_log_entity_time_idx", "audit_log_actor_time_idx"):
        db.execute(f"DROP INDEX {index}")
    db.execute("CREATE INDEX time_entries_project_id_idx ON time_entries (project_id)")
    db.execute("CREATE INDEX audit_log_entity_idx ON audit_log (entity, entity_id)")
    db.execute("CREATE INDEX audit_log_actor_idx ON audit_log (actor_id)")

    create_schema(db)

    assert {"time_entries_project_date_idx", "time_entries_milestone_id_idx"} <= index_names(db, "time_entries")
    assert "time_entries_project_id_idx" not in index_names(db, "time_entries")
    assert index_names(db, "audit_log") >= {"audit_log_entity_time_idx", "audit_log_actor_time_idx"}
    assert not index_names(db, "audit_log") & {"audit_log_entity_idx", "audit_log_actor_idx"}
    assert "users_search_idx" in index_names(db, "users")
