from pydantic_settings import BaseSettings
from pydantic import AnyUrl
from typing import List, Optional
from pathlib import Path
from dotenv import load_dotenv
import os

class Settings(BaseSettings):
    # CORS – keep env parsing simple: store raw string, parse in app.py
    # This avoids pydantic-settings trying to JSON-decode LIST values and crashing
    # when Railway stores comma-separated strings or '*'.
    ALLOW_ORIGINS: str | None = None
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
    MAGENTO_BASE_URL: str | None = None
    MAGENTO_ACCESS_TOKEN: str | None = None

    # DB: attendance (psycopg2)
    ATTENDANCE_DB_HOST: str | None = None
    ATTENDANCE_DB_PORT: int | None = None
    ATTENDANCE_DB_NAME: str | None = None
    ATTENDANCE_DB_USER: str | None = None
    ATTENDANCE_DB_PASSWORD: str | None = None

    # DB: labels (SQLAlchemy URI string)
    LABELS_DB_URI: Optional[str] = None

    # DB: inventory_logs (psycopg2)
    INVENTORY_LOGS_HOST: str | None = None
    INVENTORY_LOGS_PORT: int | None = None
    INVENTORY_LOGS_NAME: str | None = None
    INVENTORY_LOGS_USER: str | None = None
    INVENTORY_LOGS_PASSWORD: str | None = None

    # Zoho credentials (token manager uses these)
    ZC_CLIENT_ID: str | None = None
    ZC_CLIENT_SECRET: str | None = None
    ZC_REFRESH_TOKEN: str | None = None
    
    # Extra Zoho settings
    ZC_APP_LINK: str | None = None
    ZC_LOG_FORM: str | None = None
    ZC_ORG_ID: str | None = None
    ZOHO_ACCOUNTS_BASE: str | None = None

    class Config:
        # Railway provides environment variables directly - no .env file needed in production
        case_sensitive = False

settings = Settings()
