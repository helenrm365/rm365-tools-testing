"""
France Order Fulfillment Module

Handles order fulfillment for France region:
- Order approvals from FR and NL Magento databases
- Inventory operations against fr_paris_inventory table
- Session tracking in france_order_fulfillment_sessions table
"""
from .api import router

__all__ = ['router']
