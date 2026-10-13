"""
Shared SQL and constants used by every model.
"""

# A full-time work week; weekly totals above this are flagged
HOURS_PER_WEEK = 40
# Annual working hours (40 h x 52 weeks), used to turn a salary into an hourly rate
HOURS_PER_YEAR = 2080

SCHEMA = """
-- Trigram matching lets indexes speed up "contains" searches (ILIKE '%term%').
-- Installed in public so test schemas can't drop it along with themselves.
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END $$;
"""


def updated_at_trigger(table: str) -> str:
    """SQL that keeps a table's updated_at column current on every update."""
    return (
        f"CREATE OR REPLACE TRIGGER {table}_updated_at BEFORE UPDATE ON {table} "
        f"FOR EACH ROW EXECUTE FUNCTION set_updated_at();"
    )
