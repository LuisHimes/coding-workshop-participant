"""
Dependency injection wiring: the one place that decides how objects are built.

FastAPI resolves these per request. A controller declares what it needs with a
type alias, e.g.

    @router.get("/projects")
    def list_projects(projects: ProjectRepositoryDep): ...

and FastAPI opens (or reuses) the database connection, builds the repository
with it, and passes it in. Services follow the same pattern: a provider takes
the repositories a service needs and returns the service, e.g.

    def get_project_service(projects: ProjectRepositoryDep, ...) -> ProjectService:
        return ProjectService(projects, ...)

    ProjectServiceDep = Annotated[ProjectService, Depends(get_project_service)]

Routes that need a logged-in user take CurrentUser, or a role guard such as
AdminUser. FastAPI's OAuth2 support reads the bearer token from the
Authorization header.

To swap an implementation (in tests, for instance), override the provider:

    app.dependency_overrides[get_db] = lambda: test_connection
    app.dependency_overrides[get_project_repository] = lambda: FakeProjectRepository()
"""

from typing import Annotated

import jwt
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordBearer
from psycopg import Connection

from database import get_db
from repository.audit import AuditRepository
from repository.dashboard import DashboardRepository
from repository.messages import MessageRepository
from repository.milestones import MilestoneRepository
from repository.projects import ProjectRepository
from repository.teams import TeamRepository
from repository.time_entries import TimeEntryRepository
from repository.users import UserRepository
from service.audit import AuditService
from service.auth import AuthService
from service.messages import MessageService
from service.milestones import MilestoneService
from service.projects import ProjectService
from service.reports import ReportService
from service.security import decode_access_token
from service.teams import TeamService
from service.time_entries import TimeEntryService
from service.users import UserService

DbConnection = Annotated[Connection, Depends(get_db)]


# Repositories


def get_user_repository(db: DbConnection) -> UserRepository:
    return UserRepository(db)


def get_project_repository(db: DbConnection) -> ProjectRepository:
    return ProjectRepository(db)


def get_milestone_repository(db: DbConnection) -> MilestoneRepository:
    return MilestoneRepository(db)


def get_time_entry_repository(db: DbConnection) -> TimeEntryRepository:
    return TimeEntryRepository(db)


def get_message_repository(db: DbConnection) -> MessageRepository:
    return MessageRepository(db)


def get_audit_repository(db: DbConnection) -> AuditRepository:
    return AuditRepository(db)


def get_dashboard_repository(db: DbConnection) -> DashboardRepository:
    return DashboardRepository(db)


def get_team_repository(db: DbConnection) -> TeamRepository:
    return TeamRepository(db)


UserRepositoryDep = Annotated[UserRepository, Depends(get_user_repository)]
ProjectRepositoryDep = Annotated[ProjectRepository, Depends(get_project_repository)]
MilestoneRepositoryDep = Annotated[MilestoneRepository, Depends(get_milestone_repository)]
TimeEntryRepositoryDep = Annotated[TimeEntryRepository, Depends(get_time_entry_repository)]
MessageRepositoryDep = Annotated[MessageRepository, Depends(get_message_repository)]
AuditRepositoryDep = Annotated[AuditRepository, Depends(get_audit_repository)]
DashboardRepositoryDep = Annotated[DashboardRepository, Depends(get_dashboard_repository)]
TeamRepositoryDep = Annotated[TeamRepository, Depends(get_team_repository)]


# Services


def get_auth_service(users: UserRepositoryDep, audit: AuditRepositoryDep) -> AuthService:
    return AuthService(users, audit)


def get_user_service(users: UserRepositoryDep) -> UserService:
    return UserService(users)


def get_project_service(projects: ProjectRepositoryDep, users: UserRepositoryDep,
                        dashboard: DashboardRepositoryDep) -> ProjectService:
    return ProjectService(projects, users, dashboard)


ProjectServiceDep = Annotated[ProjectService, Depends(get_project_service)]


def get_milestone_service(milestones: MilestoneRepositoryDep, projects: ProjectRepositoryDep,
                          project_service: ProjectServiceDep) -> MilestoneService:
    return MilestoneService(milestones, projects, project_service)


def get_time_entry_service(time_entries: TimeEntryRepositoryDep, projects: ProjectRepositoryDep,
                           dashboard: DashboardRepositoryDep, project_service: ProjectServiceDep) -> TimeEntryService:
    return TimeEntryService(time_entries, projects, dashboard, project_service)


def get_message_service(messages: MessageRepositoryDep, projects: ProjectRepositoryDep,
                        project_service: ProjectServiceDep) -> MessageService:
    return MessageService(messages, projects, project_service)


def get_audit_service(audit: AuditRepositoryDep) -> AuditService:
    return AuditService(audit)


def get_team_service(teams: TeamRepositoryDep, users: UserRepositoryDep, projects: ProjectRepositoryDep,
                     project_service: ProjectServiceDep) -> TeamService:
    return TeamService(teams, users, projects, project_service)


TeamServiceDep = Annotated[TeamService, Depends(get_team_service)]


def get_report_service(dashboard: DashboardRepositoryDep, projects: ProjectRepositoryDep,
                       milestones: MilestoneRepositoryDep, users: UserRepositoryDep,
                       project_service: ProjectServiceDep, team_service: TeamServiceDep) -> ReportService:
    return ReportService(dashboard, projects, milestones, users, project_service, team_service)


AuthServiceDep = Annotated[AuthService, Depends(get_auth_service)]
UserServiceDep = Annotated[UserService, Depends(get_user_service)]
MilestoneServiceDep = Annotated[MilestoneService, Depends(get_milestone_service)]
TimeEntryServiceDep = Annotated[TimeEntryService, Depends(get_time_entry_service)]
MessageServiceDep = Annotated[MessageService, Depends(get_message_service)]
AuditServiceDep = Annotated[AuditService, Depends(get_audit_service)]
ReportServiceDep = Annotated[ReportService, Depends(get_report_service)]


# Authentication

# Relative URL, so the interactive docs log in correctly behind /api/main too
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="auth/token")


def get_current_user_allow_temporary_password(
    request: Request, token: Annotated[str, Depends(oauth2_scheme)], users: UserRepositoryDep,
    audit: AuditRepositoryDep,
) -> dict:
    """
    The logged-in user, even one who still has a temporary password. Only the
    routes that let them change it should use this; everything else uses
    CurrentUser. Also records who is acting, for the audit log and request logs.
    """
    unauthorized = HTTPException(
        status.HTTP_401_UNAUTHORIZED, "Not logged in or session expired", headers={"WWW-Authenticate": "Bearer"})
    try:
        claims = decode_access_token(token)
    except jwt.InvalidTokenError:
        raise unauthorized
    user = users.get(claims["sub"])
    if user is None or not user["is_active"]:
        raise unauthorized
    audit.set_actor(user["id"])
    request.state.user_id = user["id"]
    return user


def get_current_user(
    user: Annotated[dict, Depends(get_current_user_allow_temporary_password)],
) -> dict:
    """The logged-in user, who must have replaced their temporary password."""
    if user["must_change_password"]:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Change your temporary password before continuing")
    return user


def require_role(*roles: str):
    """Dependency that allows only logged-in users with one of the given roles."""
    def check(user: Annotated[dict, Depends(get_current_user)]) -> dict:
        if user["role"] not in roles:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "You do not have permission to do this")
        return user
    return check


CurrentUserAllowTemporaryPassword = Annotated[dict, Depends(get_current_user_allow_temporary_password)]
CurrentUser = Annotated[dict, Depends(get_current_user)]
AdminUser = Annotated[dict, Depends(require_role("admin"))]
ManagerOrAdminUser = Annotated[dict, Depends(require_role("manager", "admin"))]
