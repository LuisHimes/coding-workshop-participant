"""
Milestone templates: a manager's predefined milestones, reused across projects.

- Managers create, edit and delete their own templates. Admins manage every
  template, choosing the manager on creation.
- Other managers and employees can't see a manager's templates.
- Templates hold no dates. Adding a template's milestones to a project goes
  through MilestoneService.create_milestones, with a date range for each.
"""

from models.milestone_templates import MilestoneTemplate, MilestoneTemplateCreate, MilestoneTemplateUpdate
from repositories.milestone_templates import MilestoneTemplateRepository
from repositories.users import UserRepository
from services.base import is_admin, is_manager, require_role
from services.errors import InvalidRequestError, NotFoundError, database_rules
from services.users import require_active_manager


class MilestoneTemplateService:
    """Manages milestone templates (managers' own, or any for admins)."""

    def __init__(self, templates: MilestoneTemplateRepository, users: UserRepository):
        self.templates = templates
        self.users = users

    def get_visible(self, actor: dict, template_id: int) -> dict:
        """The template if the actor may see and manage it (its manager or an admin), otherwise NotFoundError."""
        require_role(actor, "manager", "admin")
        template = self.templates.get(template_id)
        if template is None or not (is_admin(actor) or template["manager_id"] == actor["id"]):
            raise NotFoundError("Milestone template not found")
        return template

    def create_template(self, actor: dict, data: MilestoneTemplateCreate) -> MilestoneTemplate:
        """Managers create templates for themselves; admins choose an active manager."""
        require_role(actor, "manager", "admin")
        if is_manager(actor):
            if data.manager_id and data.manager_id.upper() != actor["id"]:
                raise InvalidRequestError("Managers can only create milestone templates for themselves")
            manager_id = actor["id"]
        else:
            manager_id = require_active_manager(self.users, data.manager_id)
        values = {"name": data.name, "description": data.description, "manager_id": manager_id}
        with database_rules():
            template = self.templates.create(values, [m.model_dump() for m in data.milestones])
        return MilestoneTemplate.model_validate(template)

    def list_templates(self, actor: dict, q: str | None = None, manager_id: str | None = None) -> list[MilestoneTemplate]:
        """Managers see their own templates; admins see every template, optionally one manager's."""
        require_role(actor, "manager", "admin")
        if is_manager(actor):
            manager_id = actor["id"]
        rows = self.templates.find(manager_id=manager_id.upper() if manager_id else None, q=q)
        return [MilestoneTemplate.model_validate(row) for row in rows]

    def get_template(self, actor: dict, template_id: int) -> MilestoneTemplate:
        """The template, if the actor is its manager or an admin."""
        return MilestoneTemplate.model_validate(self.get_visible(actor, template_id))

    def update_template(self, actor: dict, template_id: int, data: MilestoneTemplateUpdate) -> MilestoneTemplate:
        """Edits the template; a given milestones list replaces the existing one."""
        self.get_visible(actor, template_id)
        values = data.model_dump(exclude_unset=True, exclude={"milestones"})
        items = [m.model_dump() for m in data.milestones] if data.milestones is not None else None
        with database_rules():
            return MilestoneTemplate.model_validate(self.templates.update(template_id, values, items))

    def delete_template(self, actor: dict, template_id: int) -> None:
        """Deletes the template. Milestones already added to projects from it are kept."""
        self.get_visible(actor, template_id)
        self.templates.delete(template_id)
