"""
Time entry routes. Permissions are checked in TimeEntryService.
"""

from datetime import date

from fastapi import APIRouter, Response, status

from dependencies import CurrentUser, TimeEntryServiceDep
from models.time_entries import TimeEntry, TimeEntryCreate, TimeEntryLogged, TimeEntryUpdate

router = APIRouter(prefix="/time-entries", tags=["time entries"])


@router.get("")
def list_time_entries(user: CurrentUser, time_entries: TimeEntryServiceDep, user_id: str | None = None,
                      project_id: int | None = None, start: date | None = None,
                      end: date | None = None) -> list[TimeEntry]:
    """Employees see their own hours, managers their projects' hours, admins everyone's."""
    return time_entries.list_time_entries(user, user_id=user_id, project_id=project_id, start=start, end=end)


@router.post("", status_code=status.HTTP_201_CREATED)
def log_time(body: TimeEntryCreate, user: CurrentUser, time_entries: TimeEntryServiceDep) -> TimeEntryLogged:
    """Employees log hours on their projects; the response includes the week's total."""
    return time_entries.log_time(user, body)


@router.patch("/{entry_id}")
def update_time_entry(entry_id: int, body: TimeEntryUpdate, user: CurrentUser,
                      time_entries: TimeEntryServiceDep) -> TimeEntryLogged:
    """Edit one of your entries on an open project (admins: any entry); the response includes the week's total."""
    return time_entries.update_time_entry(user, entry_id, body)


@router.delete("/{entry_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_time_entry(entry_id: int, user: CurrentUser, time_entries: TimeEntryServiceDep) -> Response:
    """Delete one of your entries on an open project (admins: any entry)."""
    time_entries.delete_time_entry(user, entry_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
