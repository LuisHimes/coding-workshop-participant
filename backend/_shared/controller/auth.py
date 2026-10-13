"""
Login endpoints (OAuth2 password flow with JWT bearer tokens).

1. POST /auth/token with form fields username (the user's email address; the
   OAuth2 password flow names this field "username") and password returns an
   access token.
2. Send it on every request: Authorization: Bearer <access_token>
3. Users with a temporary password must call POST /auth/change-password
   before any other route will accept their token.
"""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status
from fastapi.security import OAuth2PasswordRequestForm

from dependencies import AuthServiceDep, CurrentUser, CurrentUserAllowTemporaryPassword, UserServiceDep
from models.auth import Token
from models.users import PasswordChange, User, UserSelfUpdate, UserWithSalary
from service.auth import AuthError

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/token", response_model=Token)
def login(form: Annotated[OAuth2PasswordRequestForm, Depends()], auth: AuthServiceDep):
    """Log in with your email address (in the username field) and password."""
    try:
        return auth.login(form.username, form.password)
    except AuthError as e:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, str(e), headers={"WWW-Authenticate": "Bearer"})


@router.get("/me")
def me(user: CurrentUserAllowTemporaryPassword) -> UserWithSalary | User:
    """The logged-in user. Employees don't see salaries, including their own."""
    return User.model_validate(user) if user["role"] == "employee" else UserWithSalary.model_validate(user)


@router.patch("/me")
def update_me(body: UserSelfUpdate, user: CurrentUser, users: UserServiceDep) -> UserWithSalary | User:
    """Change your own name and email. Job title, salary and role are set by admins."""
    return users.update_self(user, body)


@router.post("/change-password", status_code=status.HTTP_204_NO_CONTENT)
def change_password(body: PasswordChange, user: CurrentUserAllowTemporaryPassword, auth: AuthServiceDep):
    """Replaces the user's password; required after logging in with a temporary one."""
    try:
        auth.change_password(user["id"], body.current_password, body.new_password)
    except AuthError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e))
    return Response(status_code=status.HTTP_204_NO_CONTENT)
