"""
Tests for service/errors.py: turning PostgreSQL rule violations into
service errors with messages written for people.

Run from backend/_shared: pytest
"""

import pytest
from psycopg import errors as pg_errors

from service.errors import ConflictError, database_rules


def test_unknown_unique_constraints_get_a_generic_message():
    with pytest.raises(ConflictError, match="^That record already exists$"):
        with database_rules():
            raise pg_errors.UniqueViolation("duplicate key value violates unique constraint \"users_pkey\"")


def test_foreign_key_violations_become_conflicts():
    with pytest.raises(ConflictError, match="referenced record does not exist") as raised:
        with database_rules():
            raise pg_errors.ForeignKeyViolation("insert or update violates foreign key constraint")
    assert isinstance(raised.value.__cause__, pg_errors.ForeignKeyViolation)


def test_check_violations_without_a_message_get_a_generic_one():
    with pytest.raises(ConflictError, match="breaks a project rule"):
        with database_rules():
            raise pg_errors.CheckViolation()


def test_other_errors_pass_through_unchanged():
    with pytest.raises(ValueError):
        with database_rules():
            raise ValueError("not a database rule")
