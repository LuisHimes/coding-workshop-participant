"""
Hours logged by employees, which drive budget tracking.

- Employees log, edit and delete their own hours on open projects they are
  members of. Each save reports their total for that week, flagged above 40.
- Managers see the hours logged on their projects; admins see everything and
  can correct any entry.
"""

from datetime import date

from models.base import HOURS_PER_WEEK
from models.time_entries import TimeEntry, TimeEntryCreate, TimeEntryLogged, TimeEntryUpdate
from repositories.dashboard import DashboardRepository
from repositories.projects import ProjectRepository
from repositories.time_entries import TimeEntryRepository
from services.base import is_admin, is_employee, is_manager, require_role
from services.errors import ConflictError, NotFoundError, database_rules
from services.projects import ProjectService


class TimeEntryService:
    """Logs, lists, edits and deletes the hours employees work."""

    def __init__(self, time_entries: TimeEntryRepository, projects: ProjectRepository,
                 dashboard: DashboardRepository, project_service: ProjectService):
        self.time_entries = time_entries
        self.projects = projects
        self.dashboard = dashboard
        self.project_service = project_service

    def log_time(self, actor: dict, data: TimeEntryCreate) -> TimeEntryLogged:
        """Employees log hours on open projects they are members of. Returns the entry with that week's total."""
        require_role(actor, "employee")
        project = self.projects.get(data.project_id)
        if project is None or not self.projects.is_member(data.project_id, actor["id"]):
            raise NotFoundError("Project not found")
        self._require_open(project)
        with database_rules():
            entry = self.time_entries.create(actor["id"], data.model_dump())
        return self._with_week_total(entry)

    def list_time_entries(self, actor: dict, user_id: str | None = None, project_id: int | None = None,
                          start: date | None = None, end: date | None = None) -> list[TimeEntry]:
        """Employees see their own hours; managers, their projects' hours; admins, everyone's."""
        project_ids = None
        if is_employee(actor):
            user_id = actor["id"]
        elif is_manager(actor):
            if project_id is not None:
                self.project_service.get_visible(actor, project_id)
            else:
                project_ids = [p["id"] for p in self.projects.find(manager_id=actor["id"])]
        rows = self.time_entries.find(user_id=user_id.upper() if user_id else None, project_id=project_id,
                                      project_ids=project_ids, start=start, end=end)
        return [TimeEntry.model_validate(row) for row in rows]

    def update_time_entry(self, actor: dict, entry_id: int, data: TimeEntryUpdate) -> TimeEntryLogged:
        """
        Employees edit their own entries on open projects; admins edit any.
        Returns the entry with that week's total.
        """
        entry = self._editable(actor, entry_id)
        with database_rules():
            updated = self.time_entries.update(entry["id"], data.model_dump(exclude_unset=True))
        return self._with_week_total(updated)

    def delete_time_entry(self, actor: dict, entry_id: int) -> None:
        """Employees delete their own entries on open projects; admins delete any."""
        entry = self._editable(actor, entry_id)
        self.time_entries.delete(entry["id"])

    def _editable(self, actor: dict, entry_id: int) -> dict:
        entry = self.time_entries.get(entry_id)
        if entry is None or not (is_admin(actor) or entry["user_id"] == actor["id"]):
            raise NotFoundError("Time entry not found")
        if not is_admin(actor):
            self._require_open(self.projects.get(entry["project_id"]))
        return entry

    def _require_open(self, project: dict) -> None:
        if project["archived_at"] is not None:
            raise ConflictError("Hours can't be logged on an archived project")

    def _with_week_total(self, entry: dict) -> TimeEntryLogged:
        hours = self.dashboard.hours_in_week(entry["user_id"], entry["work_date"])
        return TimeEntryLogged(**entry, week_hours=hours, over_limit=hours > HOURS_PER_WEEK)

