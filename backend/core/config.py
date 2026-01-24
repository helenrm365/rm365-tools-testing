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

    # Magento DB credentials
    MAGENTO_DB_PORT: int = 3306
    
    MAGENTO_DB_HOST_UK: str = "rm365uk.hypernode.io"
    MAGENTO_DB_NAME_UK: str = "magento_uk"
    MAGENTO_DB_USER_UK: Optional[str] = None
    MAGENTO_DB_PASSWORD_UK: Optional[str] = None

    MAGENTO_DB_HOST_NL: str = "rm365nl.hypernode.io"
    MAGENTO_DB_NAME_NL: str = "magento_nl"
    MAGENTO_DB_USER_NL: Optional[str] = None
    MAGENTO_DB_PASSWORD_NL: Optional[str] = None

    MAGENTO_DB_HOST_FR: str = "rm365fr.hypernode.io"
    MAGENTO_DB_NAME_FR: str = "magento_fr"
    MAGENTO_DB_USER_FR: Optional[str] = None
    MAGENTO_DB_PASSWORD_FR: Optional[str] = None

    # Scheduler settings
    # Set to false on secondary instances to prevent duplicate scheduled jobs
    SCHEDULER_ENABLED: bool = False  # Set SCHEDULER_ENABLED=true in .env to enable

    class Config:
        # Environment variables provided directly - no .env file needed in production
        case_sensitive = False

settings = Settings()
