from pydantic_settings import BaseSettings
from pydantic import AnyUrl
from typing import List, Optional
from pathlib import Path
from dotenv import load_dotenv
import os

class Settings(BaseSettings):
    # CORS – keep env parsing simple: store raw string, parse in app.py
    # This avoids pydantic-settings trying to JSON-decode LIST values and crashing
    # when environment stores comma-separated strings or '*'.
    ALLOW_ORIGINS: Optional[str] = None
    # Allow all Cloudflare Pages preview deployments by default
    ALLOW_ORIGIN_REGEX: str = r"https://.*\.pages\.dev"

    # Auth/JWT
    AUTH_SECRET_KEY: str = "change-me"       # set via ENV in production
    AUTH_ALGORITHM: str = "HS256"
    AUTH_ACCESS_TTL_DAYS: int = 7
    
    # Built-in superadmin account (bypasses database, full access)
    SUPERADMIN_USERNAME: str = "superadmin"
    SUPERADMIN_PASSWORD: str = "admin123"  # Change this in production!
    
    # Magento API credentials
    MAGENTO_BASE_URL: Optional[str] = None
    MAGENTO_ACCESS_TOKEN: Optional[str] = None

    # DB: attendance (psycopg2)
    ATTENDANCE_DB_HOST: Optional[str] = None
    ATTENDANCE_DB_PORT: Optional[int] = None
    ATTENDANCE_DB_NAME: Optional[str] = None
    ATTENDANCE_DB_USER: Optional[str] = None
    ATTENDANCE_DB_PASSWORD: Optional[str] = None

    # DB: labels (SQLAlchemy URI string)
    LABELS_DB_URI: Optional[str] = None

    # DB: inventory_logs (psycopg2)
    INVENTORY_LOGS_HOST: Optional[str] = None
    INVENTORY_LOGS_PORT: Optional[int] = None
    INVENTORY_LOGS_NAME: Optional[str] = None
    INVENTORY_LOGS_USER: Optional[str] = None
    INVENTORY_LOGS_PASSWORD: Optional[str] = None

    class Config:
        # Environment variables provided directly - no .env file needed in production
        case_sensitive = False

settings = Settings()
