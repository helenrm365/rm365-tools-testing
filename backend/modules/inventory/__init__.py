# Inventory module
"""
Inventory module for rm365-tools

This module handles:
- Inventory management: Metadata stored in PostgreSQL
- Inventory adjustments: Logged to PostgreSQL
- Collaboration: Real-time collaboration features for inventory management
- Sourcing: Supplier price comparison and margin analysis
- Scanning Logs: Track and audit scanner submissions

Sub-modules:
- management: CRUD for inventory metadata, live sync support
- adjustments: Log and sync inventory adjustments
- collaboration: Real-time collaboration and presence
- sourcing: Multi-supplier pricing, FX rates, and analysis dashboard
- scanning_logs: Scanner submission logging and audit trail
"""

from .management.api import router as management_router
from .adjustments.api import router as adjustments_router
from .collaboration import router as collaboration_router
from .sourcing.api import router as sourcing_router
from .scanning_logs.api import router as scanning_logs_router

__all__ = ["management_router", "adjustments_router", "collaboration_router", "sourcing_router", "scanning_logs_router"]
