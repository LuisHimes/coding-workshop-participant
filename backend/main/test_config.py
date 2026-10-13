"""
Tests for configuration loading.

Run from the service folder: pytest
"""

import pytest
from psycopg.conninfo import conninfo_to_dict
from pydantic import ValidationError

from config import Settings

SECRET = "s" * 32


@pytest.fixture
def clean_env(monkeypatch):
    """Removes any real configuration variables so only the test's sources count."""
    for name in list(Settings.model_fields):
        monkeypatch.delenv(name.upper(), raising=False)
    return monkeypatch


def env_file(tmp_path, name, content):
    path = tmp_path / name
    path.write_text(content)
    return path


def test_env_overrides_env_development(tmp_path, clean_env):
    development = env_file(tmp_path, ".env.development", f"POSTGRES_HOST=dev-host\nJWT_SECRET={SECRET}\n")
    personal = env_file(tmp_path, ".env", "POSTGRES_HOST=my-host\n")
    settings = Settings(_env_file=[development, personal])
    assert settings.postgres_host == "my-host"
    assert settings.jwt_secret == SECRET


def test_environment_variables_override_env_files(tmp_path, clean_env):
    development = env_file(tmp_path, ".env.development", f"POSTGRES_HOST=dev-host\nJWT_SECRET={SECRET}\n")
    clean_env.setenv("POSTGRES_HOST", "172.17.0.1")  # as Terraform injects it into the Lambda
    assert Settings(_env_file=[development]).postgres_host == "172.17.0.1"


def test_jwt_secret_is_required(clean_env):
    with pytest.raises(ValidationError, match="jwt_secret"):
        Settings(_env_file=None)


def test_jwt_secret_must_be_at_least_32_characters(clean_env):
    clean_env.setenv("JWT_SECRET", "too-short")
    with pytest.raises(ValidationError, match="at least 32 characters"):
        Settings(_env_file=None)


def test_connection_string_quotes_special_characters(clean_env):
    clean_env.setenv("JWT_SECRET", SECRET)
    clean_env.setenv("POSTGRES_PASS", "p@ss word='x'")
    parsed = conninfo_to_dict(Settings(_env_file=None).pg_config)
    assert parsed["password"] == "p@ss word='x'"
    assert parsed["dbname"] == "postgres"
