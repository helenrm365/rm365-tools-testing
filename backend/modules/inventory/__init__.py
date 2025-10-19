# Inventory module
"""
Inventory module for rm365-tools

This module handles:
- Inventory management: Metadata stored in PostgreSQL, synced with Zoho Inventory
- Inventory adjustments: Logged to PostgreSQL and synced to Zoho as inventory adjustments

Sub-modules:
- management: CRUD for inventory metadata, live sync with Zoho
- adjustments: Log and sync inventory adjustments
"""

from .management.api import router as management_router
from .adjustments.api import router as adjustments_router

__all__ = ["management_router", "adjustments_router"]
