"""
Health check endpoints.
"""

from fastapi import APIRouter

from dependencies import DbConnection

router = APIRouter(tags=["health"])


@router.get("/health")
def health():
    """Liveness check that does not touch the database."""
    return {"status": "ok"}


@router.get("/health/db")
def health_db(db: DbConnection):
    """Readiness check that verifies PostgreSQL connectivity."""
    row = db.execute("SELECT version() AS version").fetchone()
    return {"status": "ok", "postgres": row["version"]}
