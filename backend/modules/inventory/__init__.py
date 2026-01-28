# Inventory module
"""
Inventory module for rm365-tools

This module handles:
- Inventory management: Metadata stored in PostgreSQL
- Inventory adjustments: Logged to PostgreSQL
- Collaboration: Real-time collaboration features for inventory management

Sub-modules:
- management: CRUD for inventory metadata, live sync support
- adjustments: Log and sync inventory adjustments
- collaboration: Real-time collaboration and presence
"""

from .management.api import router as management_router
from .adjustments.api import router as adjustments_router
from .collaboration import router as collaboration_router

__all__ = ["management_router", "adjustments_router", "collaboration_router"]
