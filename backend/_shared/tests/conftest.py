"""
Shared pytest fixtures.

The db fixture gives each test its own temporary PostgreSQL schema with the
full app schema applied, so tests are isolated and never touch application
data. Tests that use it are skipped when PostgreSQL is unreachable.
"""

import uuid

import pytest
from psycopg import connect
from psycopg.rows import dict_row

from config import settings
from database import create_schema


@pytest.fixture
def db():
    try:
        conn = connect(settings.pg_config, autocommit=True, row_factory=dict_row)
    except Exception as e:
        pytest.skip(f"PostgreSQL not reachable: {e}")
    schema = f"test_{uuid.uuid4().hex[:12]}"
    conn.execute(f"CREATE SCHEMA {schema}")
    conn.execute(f"SET search_path TO {schema}")
    create_schema(conn)
    yield conn
    conn.execute(f"DROP SCHEMA {schema} CASCADE")
    conn.close()
