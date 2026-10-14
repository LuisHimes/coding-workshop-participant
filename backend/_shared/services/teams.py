"""
Teams: named groups of a manager's direct reports.

- Managers create, rename and delete their own teams, and add or remove their
  direct reports. Admins manage every team, choosing the manager on creation.
- Other managers and employees can't see a manager's teams.
- A manager can add a whole team to one of their projects in one step; every
  active member who isn't on the project yet joins with the same weekly hours.
"""

from decimal import Decimal

from models.teams import (
    SkippedMember, Team, TeamCreate, TeamMember, TeamStaffingResult, TeamUpdate,
)
from repositories.projects import ProjectRepository
from repositories.teams import TeamRepository
from repositories.users import UserRepository
from services.base import is_admin, is_manager, require_role
from services.errors import InvalidRequestError, NotFoundError, database_rules
from services.projects import ProjectService
from services.users import require_active_manager


class TeamService:
    """Manages teams of a manager's direct reports, and staffs projects with them."""

    def __init__(self, teams: TeamRepository, users: UserRepository, projects: ProjectRepository,
                 project_service: ProjectService):
        self.teams = teams
        self.users = users
        self.projects = projects
        self.project_service = project_service

    def get_visible(self, actor: dict, team_id: int) -> dict:
        """The team if the actor may see and manage it (its manager or an admin), otherwise NotFoundError."""
        require_role(actor, "manager", "admin")
        team = self.teams.get(team_id)
        if team is None or not (is_admin(actor) or team["manager_id"] == actor["id"]):
            raise NotFoundError("Team not found")
        return team

    # Teams

    def create_team(self, actor: dict, data: TeamCreate) -> Team:
        """Managers create teams for themselves; admins choose an active manager."""
        require_role(actor, "manager", "admin")
        if is_manager(actor):
            if data.manager_id and data.manager_id.upper() != actor["id"]:
                raise InvalidRequestError("Managers can only create teams for themselves")
            manager_id = actor["id"]
        else:
            manager_id = require_active_manager(self.users, data.manager_id)
        with database_rules():
            team = self.teams.create({"name": data.name, "description": data.description, "manager_id": manager_id})
        return Team.model_validate(team)

    def list_teams(self, actor: dict, q: str | None = None, manager_id: str | None = None) -> list[Team]:
        """Managers see their own teams; admins see every team, optionally one manager's."""
        require_role(actor, "manager", "admin")
        if is_manager(actor):
            manager_id = actor["id"]
        rows = self.teams.find(manager_id=manager_id.upper() if manager_id else None, q=q)
        return [Team.model_validate(row) for row in rows]

    def get_team(self, actor: dict, team_id: int) -> Team:
        """The team, if the actor is its manager or an admin."""
        return Team.model_validate(self.get_visible(actor, team_id))

    def update_team(self, actor: dict, team_id: int, data: TeamUpdate) -> Team:
        """Renames the team or changes its description."""
        self.get_visible(actor, team_id)
        with database_rules():
            return Team.model_validate(self.teams.update(team_id, data.model_dump(exclude_unset=True)))

    def delete_team(self, actor: dict, team_id: int) -> None:
        """Deletes the team. Its members stay on any projects the team was used to staff."""
        self.get_visible(actor, team_id)
        self.teams.delete(team_id)

    # Members

    def list_members(self, actor: dict, team_id: int) -> list[TeamMember]:
        """The team's members with their names."""
        self.get_visible(actor, team_id)
        return [TeamMember.model_validate(row) for row in self.teams.members_of(team_id)]

    def add_member(self, actor: dict, team_id: int, user_id: str) -> TeamMember:
        """Adds an active employee who reports to the team's manager."""
        team = self.get_visible(actor, team_id)
        user_id = user_id.upper()
        employee = self.users.get(user_id)
        if employee is None or employee["role"] != "employee" or not employee["is_active"]:
            raise InvalidRequestError("Only active employees can be added to a team")
        if employee["manager_id"] != team["manager_id"]:
            raise InvalidRequestError("Only employees who report to the team's manager can join the team")
        with database_rules():
            self.teams.add_member(team_id, user_id)
        return TeamMember.model_validate(self.teams.get_member(team_id, user_id))

    def remove_member(self, actor: dict, team_id: int, user_id: str) -> None:
        """Removes an employee from the team. They stay on any projects they were added to."""
        self.get_visible(actor, team_id)
        if not self.teams.remove_member(team_id, user_id.upper()):
            raise NotFoundError("That employee is not on this team")

    def member_ids(self, actor: dict, team_id: int) -> list[str]:
        """IDs of the team's members, for filtering reports."""
        self.get_visible(actor, team_id)
        return [m["user_id"] for m in self.teams.members_of(team_id)]

    # Staffing projects

    def add_team_to_project(self, actor: dict, project_id: int, team_id: int,
                            hours_per_week: Decimal) -> TeamStaffingResult:
        """
        Adds every active team member who isn't on the project yet, all or
        nothing. The result lists who was added (with their 40-hour check) and
        who was skipped and why.
        """
        self.get_visible(actor, team_id)
        self.project_service.get_manageable(actor, project_id)
        added, skipped = [], []
        with database_rules(), self.projects.transaction():
            for member in self.teams.members_of(team_id):
                if not member["is_active"]:
                    skipped.append(SkippedMember(user_id=member["user_id"], reason="Deactivated"))
                elif self.projects.is_member(project_id, member["user_id"]):
                    skipped.append(SkippedMember(user_id=member["user_id"], reason="Already on the project"))
                else:
                    row = self.projects.add_member(project_id, member["user_id"], hours_per_week, actor["id"])
                    added.append(row)
        return TeamStaffingResult(added=[self.project_service.with_allocation(row) for row in added],
                                  skipped=skipped)
