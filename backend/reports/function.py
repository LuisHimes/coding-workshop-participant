"""
Lambda entry point for the reports feature: every route under /api/reports.

The rest of this folder is copied from backend/_shared by sync.py.
"""

import logging

from mangum import Mangum

from app import create_app
from config import settings

logging.getLogger().setLevel(settings.log_level)

handler = Mangum(create_app("reports"), lifespan="off")
