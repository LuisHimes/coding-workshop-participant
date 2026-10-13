"""
Login request and response schemas. No table: credentials live in users.
"""

from typing import Literal

from pydantic import BaseModel


class Token(BaseModel):
    """OAuth2 access token response."""

    access_token: str
    token_type: Literal["bearer"] = "bearer"
    expires_in: int
    must_change_password: bool
