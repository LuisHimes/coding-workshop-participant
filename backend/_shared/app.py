"""
FastAPI applications. Each feature area is deployed as its own Lambda, built
with create_app("<feature>"), which serves only that feature's routes (plus a
health check). create_app() with no feature serves every route, for tests and
for running the whole API locally.

A feature's routes all start with its name, which is also its backend folder,
its Lambda and its CloudFront path: /api/projects/... reaches the projects
Lambda.
"""

import importlib

from fastapi import APIRouter, FastAPI

from controllers import health
from middleware import add_middleware

# Feature name -> its module in controllers/. Controllers are imported only when
# their feature is built, so each Lambda loads just its own on a cold start.
FEATURES: dict[str, str] = {
    "auth": "auth",
    "users": "users",
    "projects": "projects",
    "milestones": "milestones",
    "time-entries": "time_entries",
    "messages": "messages",
    "reports": "reports",
    "teams": "teams",
    "audit": "audit",
}


def feature_router(feature: str) -> APIRouter:
    """Imports the feature's controller module and returns its router."""
    return importlib.import_module(f"controllers.{FEATURES[feature]}").router


def create_app(feature: str | None = None) -> FastAPI:
    """The API for one feature area, or for all of them when feature is None."""
    if feature is not None and feature not in FEATURES:
        raise ValueError(f"Unknown feature {feature!r}; expected one of {', '.join(FEATURES)}")
    app = FastAPI(title=f"Coding Workshop API: {feature}" if feature else "Coding Workshop API")
    add_middleware(app, feature)
    if feature is None:
        app.include_router(health.router)
        for name in FEATURES:
            app.include_router(feature_router(name))
    else:
        app.include_router(health.router, prefix=f"/{feature}")
        app.include_router(feature_router(feature))
    return app


def __getattr__(name: str):
    """
    `app`: every feature in one app, for tests and local runs. Built on first
    use, so feature Lambdas (which only import create_app) never load it.
    """
    if name == "app":
        globals()["app"] = create_app()
        return globals()["app"]
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")


# Run the whole API locally with interactive docs at http://localhost:8000/docs
if __name__ == "__main__":
    import logging

    import uvicorn

    from config import settings

    logging.getLogger().setLevel(settings.log_level)
    uvicorn.run("app:app", host="0.0.0.0", port=8000, reload=True)
