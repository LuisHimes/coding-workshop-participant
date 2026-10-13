"""
Milestone, task and assignment routes. Milestones are created under
/projects/{project_id}/milestones. Permissions are checked in MilestoneService.
"""

from fastapi import APIRouter, Response, status

from dependencies import CurrentUser, MilestoneServiceDep
from models.milestones import (
    Milestone, MilestoneAssignment, MilestoneAssignmentCreate, MilestoneAssignmentUpdate, MilestoneTask,
    MilestoneTaskCreate, MilestoneTaskUpdate, MilestoneUpdate,
)

router = APIRouter(tags=["milestones"])


# Declared before /milestones/{milestone_id} so "active" isn't read as an ID
@router.get("/milestones/active")
def active_milestone(user: CurrentUser, milestones: MilestoneServiceDep) -> Milestone | None:
    """The logged-in employee's active milestone, or null."""
    return milestones.get_active_milestone(user)


@router.get("/milestones/{milestone_id}")
def get_milestone(milestone_id: int, user: CurrentUser, milestones: MilestoneServiceDep) -> Milestone:
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
    return milestones.list_tasks(user, milestone_id)


@router.post("/milestones/{milestone_id}/tasks", status_code=status.HTTP_201_CREATED)
def create_task(milestone_id: int, body: MilestoneTaskCreate, user: CurrentUser,
                milestones: MilestoneServiceDep) -> MilestoneTask:
    return milestones.create_task(user, milestone_id, body)


@router.patch("/milestones/tasks/{task_id}")
def update_task(task_id: int, body: MilestoneTaskUpdate, user: CurrentUser,
                milestones: MilestoneServiceDep) -> MilestoneTask:
    """Employees assigned to the milestone can mark tasks done; managers can also rename them."""
    return milestones.update_task(user, task_id, body)


@router.delete("/milestones/tasks/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_task(task_id: int, user: CurrentUser, milestones: MilestoneServiceDep) -> Response:
    milestones.delete_task(user, task_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# Assignments


@router.get("/milestones/{milestone_id}/assignments")
def list_assignments(milestone_id: int, user: CurrentUser,
                     milestones: MilestoneServiceDep) -> list[MilestoneAssignment]:
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
    milestones.unassign_employee(user, milestone_id, user_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
