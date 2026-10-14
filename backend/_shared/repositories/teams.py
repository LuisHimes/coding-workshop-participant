"""
Team and team member data access.
"""

from repositories.base import Repository, where

MEMBER_SELECT = (
    "SELECT tm.team_id, tm.user_id, u.first_name, u.last_name, u.job_title, u.is_active, tm.added_at "
    "FROM team_members tm JOIN users u ON u.id = tm.user_id"
)


class TeamRepository(Repository):
    """Reads and writes teams and their members. Teams come with their member_count."""

    table = "teams"
    columns = ["id", "name", "description", "manager_id", "created_at", "updated_at"]

    def _with_member_count(self, condition: str = "", params=()) -> list[dict]:
        return self.db.execute(
            f"SELECT {self._select(prefix='t.')}, "
            f"(SELECT count(*) FROM team_members m WHERE m.team_id = t.id) AS member_count "
            f"FROM teams t{condition} ORDER BY lower(t.name)",
            params,
        ).fetchall()

    def create(self, values: dict) -> dict:
        """Inserts a team and returns it with its member count."""
        return self.get(self._insert(values)["id"])

    def get(self, team_id: int) -> dict | None:
        """Returns the team with its member count, or None."""
        rows = self._with_member_count(" WHERE t.id = %s", (team_id,))
        return rows[0] if rows else None

    def find(self, manager_id: str | None = None, q: str | None = None) -> list[dict]:
        """Lists teams by name, optionally only one manager's or those whose name contains q."""
        conditions, params = [], []
        if manager_id:
            conditions.append("t.manager_id = %s")
            params.append(manager_id)
        if q:
            conditions.append("t.name ILIKE %s")
            params.append(f"%{q}%")
        return self._with_member_count(where(conditions), params)

    def update(self, team_id: int, values: dict) -> dict | None:
        """Updates the given fields and returns the team, or None if it does not exist."""
        return self.get(team_id) if self._update(team_id, values) else None

    def delete(self, team_id: int) -> bool:
        """Deletes a team with its memberships and returns whether it existed."""
        return self._delete(team_id)

    # Members

    def add_member(self, team_id: int, user_id: str) -> None:
        """Adds a user to the team."""
        self.db.execute("INSERT INTO team_members (team_id, user_id) VALUES (%s, %s)", (team_id, user_id))

    def members_of(self, team_id: int) -> list[dict]:
        """Lists the team's members with their names, by last name."""
        return self.db.execute(
            f"{MEMBER_SELECT} WHERE tm.team_id = %s ORDER BY u.last_name, u.first_name", (team_id,)
        ).fetchall()

    def get_member(self, team_id: int, user_id: str) -> dict | None:
        """Returns one team member with their name, or None if they are not in the team."""
        return self.db.execute(f"{MEMBER_SELECT} WHERE tm.team_id = %s AND tm.user_id = %s",
                               (team_id, user_id)).fetchone()

    def remove_member(self, team_id: int, user_id: str) -> bool:
        """Removes a user from the team and returns whether they were a member."""
        return self.db.execute(
            "DELETE FROM team_members WHERE team_id = %s AND user_id = %s", (team_id, user_id)
        ).rowcount > 0
