from pydantic_settings import BaseSettings
from pydantic import AnyUrl
from typing import List, Optional
from pathlib import Path
from dotenv import load_dotenv
import os

class Settings(BaseSettings):
    # CORS - Default settings for production (Railway + Cloudflare)
    ALLOW_ORIGINS: List[str] = [
        "https://rm365-tools-testing.pages.dev",  # Cloudflare Pages main domain
    ]

    # Auth/JWT
    AUTH_SECRET_KEY: str = "change-me"       # set via ENV in production
    AUTH_ALGORITHM: str = "HS256"
    AUTH_ACCESS_TTL_DAYS: int = 7

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
    
    # Additional CORS setting
    ALLOW_ORIGIN_REGEX: str | None = None

    class Config:
        # Railway provides environment variables directly - no .env file needed in production
        case_sensitive = False

settings = Settings()
