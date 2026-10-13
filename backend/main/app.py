"""
FastAPI application: middleware and routers.
"""

from fastapi import FastAPI

from controller import audit, auth, health, messages, milestones, projects, reports, teams, time_entries, users
from middleware import add_middleware

app = FastAPI(title="Coding Workshop API")

add_middleware(app)

app.include_router(health.router)
app.include_router(auth.router)
app.include_router(users.router)
app.include_router(projects.router)
app.include_router(teams.router)
app.include_router(milestones.router)
app.include_router(time_entries.router)
app.include_router(messages.router)
app.include_router(reports.router)
app.include_router(audit.router)
