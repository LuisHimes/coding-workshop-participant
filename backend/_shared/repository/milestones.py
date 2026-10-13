"""
Milestone, milestone task and milestone assignment data access.
"""

from repository.base import Repository

TASK_COLUMNS = ["id", "milestone_id", "title", "is_done", "done_at", "done_by", "created_at", "updated_at"]
ASSIGNMENT_COLUMNS = ["id", "milestone_id", "project_id", "user_id", "assigned_at", "finished_at"]


class MilestoneRepository(Repository):
    table = "milestones"
    columns = [
        "id", "project_id", "sequence", "title", "description", "start_date", "end_date",
        "status", "completed_at", "created_at", "updated_at",
    ]

    def create(self, project_id: int, values: dict) -> dict:
        return self._insert({"project_id": project_id, **values})

    def get(self, milestone_id: int) -> dict | None:
        return self._get(milestone_id)

    def for_project(self, project_id: int) -> list[dict]:
        return self.db.execute(
            f"SELECT {self._select()} FROM milestones WHERE project_id = %s ORDER BY sequence", (project_id,)
        ).fetchall()

    def update(self, milestone_id: int, values: dict) -> dict | None:
        return self._update(milestone_id, values)

    def delete(self, milestone_id: int) -> bool:
        return self._delete(milestone_id)

    # Tasks

    def create_task(self, milestone_id: int, title: str) -> dict:
        return self._insert({"milestone_id": milestone_id, "title": title}, "milestone_tasks", TASK_COLUMNS)

    def get_task(self, task_id: int) -> dict | None:
        return self._get(task_id, "milestone_tasks", TASK_COLUMNS)

    def tasks_for(self, milestone_id: int) -> list[dict]:
        return self.db.execute(
            f"SELECT {self._select(TASK_COLUMNS)} FROM milestone_tasks WHERE milestone_id = %s ORDER BY id",
            (milestone_id,),
        ).fetchall()

    def update_task(self, task_id: int, values: dict) -> dict | None:
        """Updates a task. Setting is_done also records done_at (via trigger); pass done_by with it."""
        return self._update(task_id, values, "milestone_tasks", TASK_COLUMNS)

    def delete_task(self, task_id: int) -> bool:
        return self._delete(task_id, "milestone_tasks")

    # Assignments

    def assign(self, milestone_id: int, user_id: str) -> dict:
        """Assigns an employee to a milestone; they must already be a member of its project."""
        return self.db.execute(
            f"INSERT INTO milestone_assignments (milestone_id, project_id, user_id) "
            f"SELECT id, project_id, %s FROM milestones WHERE id = %s "
            f"RETURNING {self._select(ASSIGNMENT_COLUMNS)}",
            (user_id, milestone_id),
        ).fetchone()

    def assignments_for(self, milestone_id: int) -> list[dict]:
        return self.db.execute(
            f"SELECT {self._select(ASSIGNMENT_COLUMNS)} FROM milestone_assignments WHERE milestone_id = %s "
            f"ORDER BY assigned_at",
            (milestone_id,),
        ).fetchall()

    def set_finished(self, milestone_id: int, user_id: str, finished: bool) -> dict | None:
        """Marks an employee's part of a milestone finished (freeing them) or unfinished."""
        return self.db.execute(
            f"UPDATE milestone_assignments SET finished_at = CASE WHEN %s THEN now() END "
            f"WHERE milestone_id = %s AND user_id = %s RETURNING {self._select(ASSIGNMENT_COLUMNS)}",
            (finished, milestone_id, user_id),
        ).fetchone()

    def unassign(self, milestone_id: int, user_id: str) -> bool:
        return self.db.execute(
            "DELETE FROM milestone_assignments WHERE milestone_id = %s AND user_id = %s", (milestone_id, user_id)
        ).rowcount > 0

    def get_active(self, user_id: str) -> dict | None:
        """Returns the employee's active milestone, if they have one."""
        return self.db.execute(
            f"SELECT {self._select(prefix='m.')} FROM milestone_assignments ma "
            f"JOIN milestones m ON m.id = ma.milestone_id AND m.status = 'in_progress' "
            f"JOIN projects p ON p.id = m.project_id AND p.archived_at IS NULL "
            f"WHERE ma.user_id = %s AND ma.finished_at IS NULL",
            (user_id,),
        ).fetchone()

    def is_assigned(self, milestone_id: int, user_id: str) -> bool:
        return self.db.execute(
            "SELECT EXISTS (SELECT 1 FROM milestone_assignments WHERE milestone_id = %s AND user_id = %s) AS assigned",
            (milestone_id, user_id),
        ).fetchone()["assigned"]

    def tasks_for_project(self, project_id: int) -> list[dict]:
        return self.db.execute(
            f"SELECT {self._select(TASK_COLUMNS, 't.')} FROM milestone_tasks t "
            f"JOIN milestones m ON m.id = t.milestone_id WHERE m.project_id = %s ORDER BY m.sequence, t.id",
            (project_id,),
        ).fetchall()

    def assignees_for_project(self, project_id: int) -> list[dict]:
        """Unfinished and finished assignments for every milestone in a project."""
        return self.db.execute(
            f"SELECT {self._select(ASSIGNMENT_COLUMNS)} FROM milestone_assignments WHERE project_id = %s "
            f"ORDER BY assigned_at",
            (project_id,),
        ).fetchall()
