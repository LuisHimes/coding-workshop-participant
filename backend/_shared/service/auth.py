"""
Authentication: logging in, changing passwords, and creating the first admin.
"""

import logging

from config import settings
from repository.audit import AuditRepository
from repository.users import UserRepository
from service.security import DUMMY_HASH, create_access_token, hash_password, verify_password

logger = logging.getLogger(__name__)


class AuthError(Exception):
    """A login or password change was refused. The message is safe to show the user."""


class AuthService:
    def __init__(self, users: UserRepository, audit: AuditRepository):
        self.users = users
        self.audit = audit

    def login(self, user_id: str, password: str) -> dict:
        """
        Checks credentials and returns an access token. Every attempt is audited.
        Unknown users, wrong passwords and deactivated accounts get the same
        error, so a failed login does not reveal which user IDs exist.
        """
        user_id = user_id.strip().upper()
        credentials = self.users.get_credentials(user_id)
        password_ok = verify_password(password, credentials["password_hash"] if credentials else DUMMY_HASH)

        if not credentials or not password_ok or not credentials["is_active"]:
            self.audit.set_actor(None)
            self.audit.record_event("LOGIN_FAILED", "users", user_id)
            raise AuthError("Incorrect user ID or password")

        self.audit.set_actor(user_id)
        self.audit.record_event("LOGIN", "users", user_id)
        token, expires_in = create_access_token(user_id, credentials["role"])
        return {"access_token": token, "expires_in": expires_in,
                "must_change_password": credentials["must_change_password"]}

    def change_password(self, user_id: str, current_password: str, new_password: str) -> None:
        """Replaces the user's password (temporary or not) with a permanent one."""
        credentials = self.users.get_credentials(user_id)
        if not credentials or not verify_password(current_password, credentials["password_hash"]):
            raise AuthError("Current password is incorrect")
        if current_password == new_password:
            raise AuthError("New password must be different from the current one")
        self.users.set_password(user_id, hash_password(new_password), must_change_password=False)


def ensure_initial_admin(users: UserRepository) -> None:
    """Creates the first admin from settings when no admin exists yet."""
    if not settings.initial_admin_password or users.find(role="admin", include_inactive=True):
        return
    users.create({
        "id": settings.initial_admin_id, "role": "admin", "first_name": "System", "last_name": "Administrator",
        "email": settings.initial_admin_email, "job_title": "Administrator",
        "password_hash": hash_password(settings.initial_admin_password), "must_change_password": True,
    })
    logger.info("Created initial admin %s", settings.initial_admin_id)
