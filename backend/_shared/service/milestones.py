"""
Milestones (deliverables), their tasks, and the employees assigned to them.

- The project's manager or an admin creates and edits milestones, tasks and
  assignments, and starts milestones. Milestones run in sequence: each depends
  on the one before it.
- Employees see their projects' milestones. On milestones they are assigned
  to, they tick tasks off and mark their own part finished, which frees them
  for their next milestone (an employee has one active milestone at a time).
- Only the manager (or an admin) decides a milestone is completed; the
  database also requires all of its tasks to be done. Completing the last
  milestone does not complete the project: the manager decides that
  separately (see ProjectService.update_project), because completing a
  project archives it.
"""

from datetime import date

from models.milestones import (
    Milestone, MilestoneAssignment, MilestoneCreate, MilestoneTask, MilestoneTaskCreate, MilestoneTaskUpdate,
    MilestoneUpdate,
)
from repository.milestones import MilestoneRepository
from repository.projects import ProjectRepository
from service.base import is_employee
from service.errors import ConflictError, InvalidRequestError, NotFoundError, PermissionDeniedError, database_rules
from service.projects import ProjectService


class MilestoneService:
    def __init__(self, milestones: MilestoneRepository, projects: ProjectRepository,
                 project_service: ProjectService):
        self.milestones = milestones
        self.projects = projects
        self.project_service = project_service

    # Access helpers

    def _visible_milestone(self, actor: dict, milestone_id: int) -> tuple[dict, dict]:
        milestone = self.milestones.get(milestone_id)
        if milestone is None:
            raise NotFoundError("Milestone not found")
        try:
            project = self.project_service.get_visible(actor, milestone["project_id"])
        except NotFoundError:
            raise NotFoundError("Milestone not found")
        return milestone, project

    def _manageable_milestone(self, actor: dict, milestone_id: int) -> tuple[dict, dict]:
        milestone, _ = self._visible_milestone(actor, milestone_id)
        project = self.project_service.get_manageable(actor, milestone["project_id"])
        return milestone, project

    # Milestones

    def list_milestones(self, actor: dict, project_id: int) -> list[Milestone]:
        self.project_service.get_visible(actor, project_id)
        return [Milestone.model_validate(row) for row in self.milestones.for_project(project_id)]

    def list_visible_milestones(self, actor: dict, start: date | None = None, end: date | None = None) -> list[Milestone]:
        """Milestones of every open project the actor can see, overlapping the date range (for the calendar)."""
        if start and end and end < start:
            raise InvalidRequestError("The end date must be on or after the start date")
        project_ids = [p.id for p in self.project_service.list_projects(actor, archived=False)]
        return [Milestone.model_validate(row) for row in self.milestones.in_projects(project_ids, start, end)]

    def get_milestone(self, actor: dict, milestone_id: int) -> Milestone:
        milestone, _ = self._visible_milestone(actor, milestone_id)
        return Milestone.model_validate(milestone)

    def create_milestone(self, actor: dict, project_id: int, data: MilestoneCreate) -> Milestone:
        self.project_service.get_manageable(actor, project_id)
        with database_rules():
            return Milestone.model_validate(self.milestones.create(project_id, data.model_dump()))

    def update_milestone(self, actor: dict, milestone_id: int, data: MilestoneUpdate) -> Milestone:
        """
        Edits details or changes status. Only the project's manager or an admin
        gets here, so they alone decide when a milestone is completed.
        """
        milestone, _ = self._manageable_milestone(actor, milestone_id)
        values = data.model_dump(exclude_unset=True)
        start = values.get("start_date", milestone["start_date"])
        end = values.get("end_date", milestone["end_date"])
        if end < start:
            raise InvalidRequestError("end_date must be on or after start_date")
        with database_rules():
            return Milestone.model_validate(self.milestones.update(milestone_id, values))

    def delete_milestone(self, actor: dict, milestone_id: int) -> None:
        """Only milestones that haven't started can be deleted, so progress history is kept."""
        milestone, _ = self._manageable_milestone(actor, milestone_id)
        if milestone["status"] != "not_started":
            raise ConflictError("Only milestones that haven't started can be deleted")
        self.milestones.delete(milestone_id)

    # Tasks

    def list_tasks(self, actor: dict, milestone_id: int) -> list[MilestoneTask]:
        self._visible_milestone(actor, milestone_id)
        return [MilestoneTask.model_validate(row) for row in self.milestones.tasks_for(milestone_id)]

    def create_task(self, actor: dict, milestone_id: int, data: MilestoneTaskCreate) -> MilestoneTask:
        self._manageable_milestone(actor, milestone_id)
        with database_rules():
            return MilestoneTask.model_validate(self.milestones.create_task(milestone_id, data.title))

    def update_task(self, actor: dict, task_id: int, data: MilestoneTaskUpdate) -> MilestoneTask:
        """
        Managers and admins can rename tasks and tick them off; employees
        assigned to the milestone can only tick them off. Ticking off tasks
        never completes the milestone: the manager decides that.
        """
        task = self.milestones.get_task(task_id)
        if task is None:
            raise NotFoundError("Task not found")
        # Employees can't see archived projects, so this already rules those out
        milestone, _ = self._visible_milestone(actor, task["milestone_id"])
        values = data.model_dump(exclude_unset=True)

        if is_employee(actor):
            if set(values) - {"is_done"}:
                raise PermissionDeniedError("Employees can only mark tasks done or not done")
            if not self.milestones.is_assigned(milestone["id"], actor["id"]):
                raise PermissionDeniedError("You can only update tasks on milestones you are assigned to")
        else:
            self.project_service.get_manageable(actor, milestone["project_id"])

        if "is_done" in values:
            values["done_by"] = actor["id"] if values["is_done"] else None
        with database_rules():
            updated = self.milestones.update_task(task_id, values)
        return MilestoneTask.model_validate(updated)

    def delete_task(self, actor: dict, task_id: int) -> None:
        task = self.milestones.get_task(task_id)
        if task is None:
            raise NotFoundError("Task not found")
        milestone, _ = self._manageable_milestone(actor, task["milestone_id"])
        if milestone["status"] == "completed":
            raise ConflictError("Tasks of a completed milestone can't be deleted")
        self.milestones.delete_task(task_id)

    # Assignments

    def list_assignments(self, actor: dict, milestone_id: int) -> list[MilestoneAssignment]:
        self._visible_milestone(actor, milestone_id)
        return [MilestoneAssignment.model_validate(row) for row in self.milestones.assignments_for(milestone_id)]

    def assign_employee(self, actor: dict, milestone_id: int, user_id: str) -> MilestoneAssignment:
        """Assigns a project member. They can be lined up for upcoming milestones in advance."""
        milestone, _ = self._manageable_milestone(actor, milestone_id)
        user_id = user_id.upper()
        if not self.projects.is_member(milestone["project_id"], user_id):
            raise InvalidRequestError("Add the employee to the project before assigning them to a milestone")
        with database_rules():
            return MilestoneAssignment.model_validate(self.milestones.assign(milestone_id, user_id))

    def unassign_employee(self, actor: dict, milestone_id: int, user_id: str) -> None:
        self._manageable_milestone(actor, milestone_id)
        if not self.milestones.unassign(milestone_id, user_id.upper()):
            raise NotFoundError("That employee is not assigned to this milestone")

    def set_finished(self, actor: dict, milestone_id: int, user_id: str, finished: bool) -> MilestoneAssignment:
        """
        Marks an employee's part of a milestone finished (freeing them for
        another) or not. Employees can do this for themselves; managers and
        admins for anyone on the milestone.
        """
        # Managers only see their own projects, so visibility is the manager check
        self._visible_milestone(actor, milestone_id)
        user_id = user_id.upper()
        if is_employee(actor) and user_id != actor["id"]:
            raise PermissionDeniedError("You can only mark your own part finished")
        with database_rules():
            assignment = self.milestones.set_finished(milestone_id, user_id, finished)
        if assignment is None:
            raise NotFoundError("That employee is not assigned to this milestone")
        return MilestoneAssignment.model_validate(assignment)

    def get_active_milestone(self, actor: dict) -> Milestone | None:
        """The actor's own active milestone, if they have one."""
        milestone = self.milestones.get_active(actor["id"])
        return Milestone.model_validate(milestone) if milestone else None
