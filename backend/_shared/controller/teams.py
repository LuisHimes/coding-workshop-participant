"""
Team routes. Managers manage their own teams; admins manage every team.
Permissions are checked in TeamService.
"""

from fastapi import APIRouter, Response, status

from dependencies import CurrentUser, TeamServiceDep
from models.teams import Team, TeamCreate, TeamMember, TeamMemberCreate, TeamUpdate

router = APIRouter(prefix="/teams", tags=["teams"])


@router.get("")
def list_teams(user: CurrentUser, teams: TeamServiceDep, q: str | None = None,
               manager_id: str | None = None) -> list[Team]:
    """Your teams (managers), or every team, optionally one manager's (admins)."""
    return teams.list_teams(user, q=q, manager_id=manager_id)


@router.post("", status_code=status.HTTP_201_CREATED)
def create_team(body: TeamCreate, user: CurrentUser, teams: TeamServiceDep) -> Team:
    """Managers create teams for themselves; admins pass the manager_id the team belongs to."""
    return teams.create_team(user, body)


@router.get("/{team_id}")
def get_team(team_id: int, user: CurrentUser, teams: TeamServiceDep) -> Team:
    return teams.get_team(user, team_id)


@router.patch("/{team_id}")
def update_team(team_id: int, body: TeamUpdate, user: CurrentUser, teams: TeamServiceDep) -> Team:
    return teams.update_team(user, team_id, body)


@router.delete("/{team_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_team(team_id: int, user: CurrentUser, teams: TeamServiceDep) -> Response:
    """Members stay on any projects the team was used to staff."""
    teams.delete_team(user, team_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/{team_id}/members")
def list_members(team_id: int, user: CurrentUser, teams: TeamServiceDep) -> list[TeamMember]:
    return teams.list_members(user, team_id)


@router.post("/{team_id}/members", status_code=status.HTTP_201_CREATED)
def add_member(team_id: int, body: TeamMemberCreate, user: CurrentUser, teams: TeamServiceDep) -> TeamMember:
    """Adds one of the team manager's direct reports."""
    return teams.add_member(user, team_id, body.user_id)


@router.delete("/{team_id}/members/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_member(team_id: int, user_id: str, user: CurrentUser, teams: TeamServiceDep) -> Response:
    teams.remove_member(user, team_id, user_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
