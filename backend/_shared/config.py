"""
Service configuration, loaded and validated once at startup.

Values come from, highest priority first:
1. Real environment variables. On AWS (and in LocalStack) Terraform injects
   the POSTGRES_* variables into the Lambda this way.
2. .env: personal overrides and real secrets. Never committed.
3. .env.development: shared local development settings. Only loaded when
   APP_ENV is "development". Never committed; copy .env.sample to start.

APP_ENV defaults to "production" when Terraform marks the Lambda as running
on AWS (IS_LOCAL=false) and to "development" otherwise. Deployed Lambdas never
read the .env files: Terraform leaves dotfiles out of the package.
"""

import os
from pathlib import Path
from typing import Literal

from psycopg.conninfo import make_conninfo
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

SERVICE_DIR = Path(__file__).parent

APP_ENV = os.getenv("APP_ENV") or ("production" if os.getenv("IS_LOCAL") == "false" else "development")
ENV_FILES = [SERVICE_DIR / ".env.development", SERVICE_DIR / ".env"] if APP_ENV == "development" else []


class Settings(BaseSettings):
    """Every setting the app reads, validated at startup. Field names match the environment variables."""

    model_config = SettingsConfigDict(env_file=ENV_FILES, env_file_encoding="utf-8", extra="ignore")

    app_env: Literal["development", "production"] = APP_ENV
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR"] = "INFO"

    # PostgreSQL (names match the variables Terraform injects)
    postgres_host: str = "localhost"
    postgres_port: int = 5432
    postgres_name: str = "postgres"
    postgres_user: str = "postgres"
    postgres_pass: str = ""
    postgres_connect_timeout: int = 15

    # OAuth2 password flow with JWT bearer tokens
    jwt_secret: str = Field(min_length=32, description="Signs access tokens; keep it secret")
    jwt_algorithm: Literal["HS256", "HS384", "HS512"] = "HS256"
    jwt_access_token_expire_minutes: int = Field(default=60, gt=0)
    jwt_issuer: str = "coding-workshop"

    # First admin account, created at startup when no admin exists yet. Its
    # password is temporary: the admin must change it at first login.
    initial_admin_id: str = Field(default="ADMIN1", pattern=r"^[A-Z0-9]{6}$")
    initial_admin_email: str = "admin@example.com"
    initial_admin_password: str | None = Field(default=None, min_length=12)

    @property
    def pg_config(self) -> str:
        """libpq connection string for psycopg, with values quoted safely."""
        return make_conninfo(
            host=self.postgres_host, port=self.postgres_port, user=self.postgres_user,
            password=self.postgres_pass, dbname=self.postgres_name,
            connect_timeout=self.postgres_connect_timeout,
        )


settings = Settings()
