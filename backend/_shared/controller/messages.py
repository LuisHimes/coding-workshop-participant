"""
Message board routes. Permissions are checked in MessageService.
"""

from fastapi import APIRouter, Query, Response, status

from dependencies import CurrentUser, MessageServiceDep
from models.messages import Message, MessageCreate

router = APIRouter(prefix="/messages", tags=["messages"])


@router.get("")
def message_board(user: CurrentUser, messages: MessageServiceDep, project_id: int | None = None,
                  limit: int = Query(default=50, ge=1, le=200)) -> list[Message]:
    """Newest first: announcements plus your projects' posts, or one project's board."""
    return messages.board(user, project_id=project_id, limit=limit)


@router.post("", status_code=status.HTTP_201_CREATED)
def post_message(body: MessageCreate, user: CurrentUser, messages: MessageServiceDep) -> Message:
    """Post to a project's board, or (admins) to everyone by leaving out project_id."""
    return messages.post(user, body)


@router.delete("/{message_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_message(message_id: int, user: CurrentUser, messages: MessageServiceDep) -> Response:
    messages.delete(user, message_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
