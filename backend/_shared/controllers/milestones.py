"""
Milestone, task and assignment routes. Milestones are created under
/projects/{project_id}/milestones. Permissions are checked in MilestoneService.
"""

from datetime import date

from fastapi import APIRouter, Response, status

from dependencies import CurrentUser, MilestoneServiceDep, MilestoneTemplateServiceDep
from models.milestone_templates import MilestoneTemplate, MilestoneTemplateCreate, MilestoneTemplateUpdate
from models.milestones import (
    Milestone, MilestoneAssignment, MilestoneAssignmentCreate, MilestoneAssignmentUpdate, MilestoneTask,
    MilestoneTaskCreate, MilestoneTaskUpdate, MilestoneUpdate,
)

router = APIRouter(tags=["milestones"])


@router.get("/milestones")
def list_milestones(user: CurrentUser, milestones: MilestoneServiceDep,
                    start: date | None = None, end: date | None = None) -> list[Milestone]:
    """Milestones of every open project you can see that overlap start..end (both optional)."""
    return milestones.list_visible_milestones(user, start, end)


# Milestone templates. Declared before /milestones/{milestone_id} so "templates" isn't read as an ID.


@router.get("/milestones/templates")
def list_templates(user: CurrentUser, templates: MilestoneTemplateServiceDep, q: str | None = None,
                   manager_id: str | None = None) -> list[MilestoneTemplate]:
    """Your milestone templates (managers), or every template, optionally one manager's (admins)."""
    return templates.list_templates(user, q=q, manager_id=manager_id)


@router.post("/milestones/templates", status_code=status.HTTP_201_CREATED)
def create_template(body: MilestoneTemplateCreate, user: CurrentUser,
                    templates: MilestoneTemplateServiceDep) -> MilestoneTemplate:
    """Managers create templates for themselves; admins pass the manager_id the template belongs to."""
    return templates.create_template(user, body)


@router.get("/milestones/templates/{template_id}")
def get_template(template_id: int, user: CurrentUser, templates: MilestoneTemplateServiceDep) -> MilestoneTemplate:
    """One of your milestone templates (managers), or any template (admins)."""
    return templates.get_template(user, template_id)


@router.patch("/milestones/templates/{template_id}")
def update_template(template_id: int, body: MilestoneTemplateUpdate, user: CurrentUser,
                    templates: MilestoneTemplateServiceDep) -> MilestoneTemplate:
    """milestones, when given, replace the template's whole list in that order."""
    return templates.update_template(user, template_id, body)


@router.delete("/milestones/templates/{template_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_template(template_id: int, user: CurrentUser, templates: MilestoneTemplateServiceDep) -> Response:
    """Milestones already added to projects from the template are kept."""
    templates.delete_template(user, template_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# Declared before /milestones/{milestone_id} so "active" isn't read as an ID
@router.get("/milestones/active")
def active_milestone(user: CurrentUser, milestones: MilestoneServiceDep) -> Milestone | None:
    """The logged-in employee's active milestone, or null."""
    return milestones.get_active_milestone(user)


@router.get("/milestones/{milestone_id}")
def get_milestone(milestone_id: int, user: CurrentUser, milestones: MilestoneServiceDep) -> Milestone:
    """A milestone of a project you can see."""
    return milestones.get_milestone(user, milestone_id)


@router.patch("/milestones/{milestone_id}")
def update_milestone(milestone_id: int, body: MilestoneUpdate, user: CurrentUser,
                     milestones: MilestoneServiceDep) -> Milestone:
    """The project's manager edits details, starts the milestone, or decides it is completed."""
    return milestones.update_milestone(user, milestone_id, body)


@router.delete("/milestones/{milestone_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_milestone(milestone_id: int, user: CurrentUser, milestones: MilestoneServiceDep) -> Response:
    """Only milestones that haven't started can be deleted."""
    milestones.delete_milestone(user, milestone_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# Tasks


@router.get("/milestones/{milestone_id}/tasks")
def list_tasks(milestone_id: int, user: CurrentUser, milestones: MilestoneServiceDep) -> list[MilestoneTask]:
    """The milestone's tasks, oldest first."""
    return milestones.list_tasks(user, milestone_id)


@router.post("/milestones/{milestone_id}/tasks", status_code=status.HTTP_201_CREATED)
def create_task(milestone_id: int, body: MilestoneTaskCreate, user: CurrentUser,
                milestones: MilestoneServiceDep) -> MilestoneTask:
    """The project's manager or an admin adds a task to the milestone."""
    return milestones.create_task(user, milestone_id, body)


@router.patch("/milestones/tasks/{task_id}")
def update_task(task_id: int, body: MilestoneTaskUpdate, user: CurrentUser,
                milestones: MilestoneServiceDep) -> MilestoneTask:
    """Employees assigned to the milestone can mark tasks done; managers can also rename them."""
    return milestones.update_task(user, task_id, body)


@router.delete("/milestones/tasks/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_task(task_id: int, user: CurrentUser, milestones: MilestoneServiceDep) -> Response:
    """The project's manager or an admin deletes a task, unless its milestone is completed."""
    milestones.delete_task(user, task_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# Assignments


@router.get("/milestones/{milestone_id}/assignments")
def list_assignments(milestone_id: int, user: CurrentUser,
                     milestones: MilestoneServiceDep) -> list[MilestoneAssignment]:
    """The employees assigned to the milestone, and whether each has finished their part."""
    return milestones.list_assignments(user, milestone_id)


@router.post("/milestones/{milestone_id}/assignments", status_code=status.HTTP_201_CREATED)
def assign_employee(milestone_id: int, body: MilestoneAssignmentCreate, user: CurrentUser,
                    milestones: MilestoneServiceDep) -> MilestoneAssignment:
    """Assigns a project member; they can be lined up for upcoming milestones in advance."""
    return milestones.assign_employee(user, milestone_id, body.user_id)


@router.patch("/milestones/{milestone_id}/assignments/{user_id}")
def set_finished(milestone_id: int, user_id: str, body: MilestoneAssignmentUpdate, user: CurrentUser,
                 milestones: MilestoneServiceDep) -> MilestoneAssignment:
    """Marks an employee's part finished (freeing them for another milestone) or not."""
    return milestones.set_finished(user, milestone_id, user_id, body.finished)


@router.delete("/milestones/{milestone_id}/assignments/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def unassign_employee(milestone_id: int, user_id: str, user: CurrentUser,
                      milestones: MilestoneServiceDep) -> Response:
    """The project's manager or an admin removes an employee from the milestone."""
    milestones.unassign_employee(user, milestone_id, user_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
