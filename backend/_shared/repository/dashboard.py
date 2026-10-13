"""
Reporting view data access.
"""

from datetime import date
from decimal import Decimal

from repository.base import Repository, where


class DashboardRepository(Repository):
    def project_status(self, project_id: int | None = None, manager_id: str | None = None,
                       include_archived: bool = False) -> list[dict]:
        """Status reports for one project, a manager's projects, or all projects."""
        conditions, params = [], []
        if project_id is not None:
            conditions.append("project_id = %s")
            params.append(project_id)
        if manager_id:
            conditions.append("manager_id = %s")
            params.append(manager_id)
        if not include_archived:
            conditions.append("NOT archived")
        return self.db.execute(
            f"SELECT * FROM project_status{where(conditions)} ORDER BY projected_end_date, project_id", params
        ).fetchall()

    def hours_in_week(self, user_id: str, day: date) -> Decimal:
        """Hours the employee logged in the Monday-to-Sunday week containing day."""
        return self.db.execute(
            "SELECT coalesce(sum(hours), 0) AS hours FROM weekly_hours "
            "WHERE user_id = %s AND week_start = date_trunc('week', %s::date)::date",
            (user_id, day),
        ).fetchone()["hours"]

    def employee_allocation(self, user_id: str) -> dict | None:
        """An employee's planned weekly hours across their open projects."""
        return self.db.execute("SELECT * FROM employee_allocation WHERE user_id = %s", (user_id,)).fetchone()

    def allocation_details(self, user_ids: list[str] | None = None) -> list[dict]:
        """
        Each employee's planned hours per open project, with names, plus their
        hours logged last calendar week. Employees with no open projects are included.
        """
        condition, params = ("", []) if user_ids is None else (" AND u.id = ANY(%s)", [user_ids])
        return self.db.execute(
            f"""
            SELECT u.id AS user_id, u.first_name, u.last_name, u.manager_id,
                   a.hours_per_week AS total_hours_per_week, a.over_limit,
                   p.id AS project_id, p.name AS project_name, pm.hours_per_week,
                   coalesce(w.hours, 0) AS last_week_logged_hours
            FROM users u
            JOIN employee_allocation a ON a.user_id = u.id
            LEFT JOIN project_members pm ON pm.user_id = u.id
            LEFT JOIN projects p ON p.id = pm.project_id
                AND p.archived_at IS NULL AND p.status IN ('planning', 'active')
            LEFT JOIN weekly_hours w ON w.user_id = u.id
                AND w.week_start = date_trunc('week', CURRENT_DATE)::date - 7
            WHERE u.is_active{condition}
            ORDER BY u.last_name, u.first_name, p.name
            """,
            params,
        ).fetchall()
