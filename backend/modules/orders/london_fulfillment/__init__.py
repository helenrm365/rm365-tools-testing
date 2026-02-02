"""
London Order Fulfillment Module

Handles order fulfillment for London region:
- Order approvals from UK Magento database (London Office Collection shipping method only)
- Inventory operations against uk_london_inventory table
- Session tracking in london_order_fulfillment_sessions table
"""
from .api import router

__all__ = ['router']
