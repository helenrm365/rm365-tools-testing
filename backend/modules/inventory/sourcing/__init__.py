# backend/modules/inventory/sourcing/__init__.py
"""
Product Sourcing Module

This module implements an advanced supplier comparison and pricing system:
- FX Rates: Live currency exchange rates management
- Supplier Matrix: Multi-supplier pricing with currency support
- Analysis Dashboard: Best price calculation and margin analysis
"""

from .api import router

__all__ = ["router"]
