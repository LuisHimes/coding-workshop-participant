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
from repositories.audit import AuditRepository
from repositories.dashboard import DashboardRepository
from repositories.messages import MessageRepository
from repositories.milestone_templates import MilestoneTemplateRepository
from repositories.milestones import MilestoneRepository
from repositories.projects import ProjectRepository
from repositories.teams import TeamRepository
from repositories.time_entries import TimeEntryRepository
from repositories.users import UserRepository
from services.audit import AuditService
from services.auth import AuthService
from services.messages import MessageService
from services.milestone_templates import MilestoneTemplateService
from services.milestones import MilestoneService
from services.projects import ProjectService
from services.reports import ReportService
from services.security import decode_access_token
from services.teams import TeamService
from services.time_entries import TimeEntryService
from services.users import UserService

DbConnection = Annotated[Connection, Depends(get_db)]


# Repositories: each one is built on the request's database connection


def get_user_repository(db: DbConnection) -> UserRepository:
    """Provides a UserRepository on the request's connection."""
    return UserRepository(db)


UserRepositoryDep = Annotated[UserRepository, Depends(get_user_repository)]


def get_project_repository(db: DbConnection) -> ProjectRepository:
    """Provides a ProjectRepository on the request's connection."""
    return ProjectRepository(db)


ProjectRepositoryDep = Annotated[ProjectRepository, Depends(get_project_repository)]


def get_milestone_repository(db: DbConnection) -> MilestoneRepository:
    """Provides a MilestoneRepository on the request's connection."""
    return MilestoneRepository(db)


MilestoneRepositoryDep = Annotated[MilestoneRepository, Depends(get_milestone_repository)]


def get_milestone_template_repository(db: DbConnection) -> MilestoneTemplateRepository:
    """Provides a MilestoneTemplateRepository on the request's connection."""
    return MilestoneTemplateRepository(db)


MilestoneTemplateRepositoryDep = Annotated[MilestoneTemplateRepository, Depends(get_milestone_template_repository)]


def get_time_entry_repository(db: DbConnection) -> TimeEntryRepository:
    """Provides a TimeEntryRepository on the request's connection."""
    return TimeEntryRepository(db)


TimeEntryRepositoryDep = Annotated[TimeEntryRepository, Depends(get_time_entry_repository)]


def get_message_repository(db: DbConnection) -> MessageRepository:
    """Provides a MessageRepository on the request's connection."""
    return MessageRepository(db)


MessageRepositoryDep = Annotated[MessageRepository, Depends(get_message_repository)]


def get_audit_repository(db: DbConnection) -> AuditRepository:
    """Provides an AuditRepository on the request's connection."""
    return AuditRepository(db)


AuditRepositoryDep = Annotated[AuditRepository, Depends(get_audit_repository)]


def get_dashboard_repository(db: DbConnection) -> DashboardRepository:
    """Provides a DashboardRepository on the request's connection."""
    return DashboardRepository(db)


DashboardRepositoryDep = Annotated[DashboardRepository, Depends(get_dashboard_repository)]


def get_team_repository(db: DbConnection) -> TeamRepository:
    """Provides a TeamRepository on the request's connection."""
    return TeamRepository(db)


TeamRepositoryDep = Annotated[TeamRepository, Depends(get_team_repository)]


# Services: built from repositories, and from other services they rely on (so
# a service is defined after the services it takes)


def get_auth_service(users: UserRepositoryDep, audit: AuditRepositoryDep) -> AuthService:
    """Provides an AuthService."""
    return AuthService(users, audit)


AuthServiceDep = Annotated[AuthService, Depends(get_auth_service)]


def get_user_service(users: UserRepositoryDep) -> UserService:
    """Provides a UserService."""
    return UserService(users)


UserServiceDep = Annotated[UserService, Depends(get_user_service)]


def get_project_service(projects: ProjectRepositoryDep, users: UserRepositoryDep,
                        dashboard: DashboardRepositoryDep) -> ProjectService:
    """Provides a ProjectService, which the other project-scoped services use for access checks."""
    return ProjectService(projects, users, dashboard)


ProjectServiceDep = Annotated[ProjectService, Depends(get_project_service)]


def get_milestone_service(milestones: MilestoneRepositoryDep, projects: ProjectRepositoryDep,
                          project_service: ProjectServiceDep) -> MilestoneService:
    """Provides a MilestoneService."""
    return MilestoneService(milestones, projects, project_service)


MilestoneServiceDep = Annotated[MilestoneService, Depends(get_milestone_service)]


def get_milestone_template_service(templates: MilestoneTemplateRepositoryDep,
                                   users: UserRepositoryDep) -> MilestoneTemplateService:
    """Provides a MilestoneTemplateService."""
    return MilestoneTemplateService(templates, users)


MilestoneTemplateServiceDep = Annotated[MilestoneTemplateService, Depends(get_milestone_template_service)]


def get_time_entry_service(time_entries: TimeEntryRepositoryDep, projects: ProjectRepositoryDep,
                           dashboard: DashboardRepositoryDep, project_service: ProjectServiceDep) -> TimeEntryService:
    """Provides a TimeEntryService."""
    return TimeEntryService(time_entries, projects, dashboard, project_service)


TimeEntryServiceDep = Annotated[TimeEntryService, Depends(get_time_entry_service)]


def get_message_service(messages: MessageRepositoryDep, projects: ProjectRepositoryDep,
                        project_service: ProjectServiceDep) -> MessageService:
    """Provides a MessageService."""
    return MessageService(messages, projects, project_service)


MessageServiceDep = Annotated[MessageService, Depends(get_message_service)]


def get_audit_service(audit: AuditRepositoryDep) -> AuditService:
    """Provides an AuditService."""
    return AuditService(audit)


AuditServiceDep = Annotated[AuditService, Depends(get_audit_service)]


def get_team_service(teams: TeamRepositoryDep, users: UserRepositoryDep, projects: ProjectRepositoryDep,
                     project_service: ProjectServiceDep) -> TeamService:
    """Provides a TeamService."""
    return TeamService(teams, users, projects, project_service)


TeamServiceDep = Annotated[TeamService, Depends(get_team_service)]


def get_report_service(dashboard: DashboardRepositoryDep, projects: ProjectRepositoryDep,
                       milestones: MilestoneRepositoryDep, users: UserRepositoryDep,
                       project_service: ProjectServiceDep, team_service: TeamServiceDep) -> ReportService:
    """Provides a ReportService."""
    return ReportService(dashboard, projects, milestones, users, project_service, team_service)


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
