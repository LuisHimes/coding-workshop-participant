"""
AWS Lambda entry point for the FastAPI service.

Terraform deploys every Python service with the handler "function.handler", so
this module exposes the FastAPI app wrapped in Mangum, which translates Lambda
Function URL events into ASGI requests.
"""

import logging

from mangum import Mangum

from app import app
from config import settings

# Configure logging for Lambda
logging.getLogger().setLevel(settings.log_level)

# Lifespan events are disabled: database connections are opened lazily instead
handler = Mangum(app, lifespan="off")

# Main entry point for local testing without Lambda
if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app:app", host="0.0.0.0", port=8000, reload=True)
