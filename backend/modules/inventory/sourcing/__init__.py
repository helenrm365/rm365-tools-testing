# Product Sourcing sub-module
"""
Product Sourcing module for inventory

This module handles:
- Supplier buy price tracking with history
- Supplier-to-internal-product mapping
- Cheapest supplier comparison
- Margin calculations and reporting
- Price import workflows (CSV + manual entry)
"""

from .api import router

__all__ = ["router"]
