"""
Base class for repositories.

A repository receives its database connection through the constructor, so
callers (and tests) decide which connection it uses. In the API, FastAPI
builds repositories per request through the providers in dependencies.py.

Table and column names are passed as psycopg sql.Identifier values, so they are
always quoted safely; values always go through query parameters.
"""

from psycopg import Connection, sql


def _columns(columns: str | list[str]) -> sql.Composable:
    if columns == "*":
        return sql.SQL("*")
    return sql.SQL(", ").join(map(sql.Identifier, columns))


class Repository:
    # The main table and the columns returned from it; subclasses override these
    table: str = ""
    columns: list[str] | str = "*"

    def __init__(self, db: Connection):
        self.db = db

    def transaction(self):
        """
        All-or-nothing block for several writes. Repositories in a request share
        one connection, so it also covers writes made through other repositories.
        """
        return self.db.transaction()

    def _insert(self, values: dict, table: str | None = None, columns: str | list[str] | None = None) -> dict:
        """Inserts a row and returns it."""
        query = sql.SQL("INSERT INTO {table} ({fields}) VALUES ({placeholders}) RETURNING {columns}").format(
            table=sql.Identifier(table or self.table),
            fields=sql.SQL(", ").join(map(sql.Identifier, values)),
            placeholders=sql.SQL(", ").join(sql.Placeholder() * len(values)),
            columns=_columns(columns or self.columns),
        )
        return self.db.execute(query, list(values.values())).fetchone()

    def _get(self, row_id, table: str | None = None, columns: str | list[str] | None = None) -> dict | None:
        query = sql.SQL("SELECT {columns} FROM {table} WHERE id = %s").format(
            table=sql.Identifier(table or self.table), columns=_columns(columns or self.columns))
        return self.db.execute(query, (row_id,)).fetchone()

    def _update(self, row_id, values: dict, table: str | None = None,
                columns: str | list[str] | None = None) -> dict | None:
        """Updates the given fields and returns the row, or None if it does not exist."""
        if not values:
            return self._get(row_id, table, columns)
        query = sql.SQL("UPDATE {table} SET {assignments} WHERE id = %s RETURNING {columns}").format(
            table=sql.Identifier(table or self.table),
            assignments=sql.SQL(", ").join(
                sql.SQL("{} = %s").format(sql.Identifier(field)) for field in values),
            columns=_columns(columns or self.columns),
        )
        return self.db.execute(query, [*values.values(), row_id]).fetchone()

    def _delete(self, row_id, table: str | None = None) -> bool:
        """Deletes a row and returns whether it existed."""
        query = sql.SQL("DELETE FROM {table} WHERE id = %s").format(table=sql.Identifier(table or self.table))
        return self.db.execute(query, (row_id,)).rowcount > 0

    def _select(self, columns: list[str] | None = None, prefix: str = "") -> str:
        """Comma-separated column list for hand-written queries, optionally table-prefixed."""
        return ", ".join(f"{prefix}{column}" for column in (columns or self.columns))


def where(conditions: list[str]) -> str:
    """Joins filter conditions into a WHERE clause, or returns '' when there are none."""
    return f" WHERE {' AND '.join(conditions)}" if conditions else ""
