"""
Message model: the home page message board. A message with no project_id is
shown to everyone; otherwise it belongs to that project's board.
"""

from datetime import datetime

from pydantic import BaseModel, Field

SCHEMA = """
CREATE TABLE IF NOT EXISTS messages (
    id         SERIAL PRIMARY KEY,
    project_id INTEGER REFERENCES projects (id) ON DELETE CASCADE,
    author_id  VARCHAR(6) NOT NULL REFERENCES users (id),
    body       TEXT NOT NULL CHECK (body <> ''),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS messages_project_created_idx ON messages (project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS messages_created_idx ON messages (created_at DESC, id DESC);
"""


class MessageCreate(BaseModel):
    project_id: int | None = None
    body: str = Field(min_length=1, max_length=5000)


class Message(BaseModel):
    id: int
    project_id: int | None
    author_id: str
    body: str
    created_at: datetime
