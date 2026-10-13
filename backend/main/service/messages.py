"""
The home page message board.

- Admins post announcements to everyone (no project) or to any project.
- Managers and employees post to the boards of projects they can see.
- Everyone reads the announcements plus their own projects' boards; admins
  read every board.
- Authors delete their own posts; admins delete any post.
"""

from models.messages import Message, MessageCreate
from repository.messages import MessageRepository
from repository.projects import ProjectRepository
from service.base import is_admin, is_employee
from service.errors import NotFoundError, PermissionDeniedError, database_rules
from service.projects import ProjectService


class MessageService:
    def __init__(self, messages: MessageRepository, projects: ProjectRepository,
                 project_service: ProjectService):
        self.messages = messages
        self.projects = projects
        self.project_service = project_service

    def post(self, actor: dict, data: MessageCreate) -> Message:
        if data.project_id is None:
            if not is_admin(actor):
                raise PermissionDeniedError("Only admins can post announcements to everyone")
        else:
            self.project_service.get_visible(actor, data.project_id)
        with database_rules():
            return Message.model_validate(self.messages.create(actor["id"], data.body, data.project_id))

    def board(self, actor: dict, project_id: int | None = None, limit: int = 50) -> list[Message]:
        """Newest posts first: announcements plus the actor's projects, or one project's board."""
        if project_id is not None:
            self.project_service.get_visible(actor, project_id)
            rows = self.messages.recent([project_id], limit, include_announcements=False)
        elif is_admin(actor):
            rows = self.messages.recent(None, limit)
        else:
            filters = {"member_id": actor["id"]} if is_employee(actor) else {"manager_id": actor["id"]}
            rows = self.messages.recent([p["id"] for p in self.projects.find(**filters)], limit)
        return [Message.model_validate(row) for row in rows]

    def delete(self, actor: dict, message_id: int) -> None:
        message = self.messages.get(message_id)
        if message is None:
            raise NotFoundError("Message not found")
        if message["project_id"] is not None:
            try:
                self.project_service.get_visible(actor, message["project_id"])
            except NotFoundError:
                raise NotFoundError("Message not found")
        if not (is_admin(actor) or message["author_id"] == actor["id"]):
            raise PermissionDeniedError("You can only delete your own messages")
        self.messages.delete(message_id)
