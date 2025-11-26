from __future__ import annotations
from datetime import datetime
from typing import List, Optional, Literal
from pydantic import BaseModel, Field


class InvoiceItemSchema(BaseModel):
    """Schema for invoice line items"""
    sku: str
    name: str
    qty_ordered: float
    qty_invoiced: float
    qty_scanned: float = 0
    price: float
    row_total: float
    product_id: Optional[int] = None
    is_complete: bool = False


class InvoiceDetailSchema(BaseModel):
    """Schema for full invoice details"""
    invoice_number: str
    order_number: str
    invoice_id: int
    order_id: int
    state: str
    grand_total: float
    created_at: str
    items: List[InvoiceItemSchema]
    billing_name: Optional[str] = None
    billing_address: Optional[str] = None


class ScanRequestSchema(BaseModel):
    """Request to scan a product"""
    session_id: str
    sku: str
    quantity: float = 1.0


class ScanResultSchema(BaseModel):
    """Result of scanning a product"""
    success: bool
    message: str
    sku: str
    item_name: Optional[str] = None
    qty_expected: float = 0
    qty_scanned: float = 0
    qty_remaining: float = 0
    is_complete: bool = False
    is_overpicked: bool = False
    all_items_complete: bool = False


class StartSessionSchema(BaseModel):
    """Schema to start a pick/pack session"""
    order_number: str
    session_type: Literal["pick", "return"] = "pick"


class SessionStatusSchema(BaseModel):
    """Current status of a scanning session"""
    session_id: str
    order_number: str
    invoice_number: str
    session_type: str
    status: str
    started_at: datetime
    items: List[InvoiceItemSchema]
    total_items: int
    completed_items: int
    progress_percentage: float


class CompleteSessionSchema(BaseModel):
    """Schema to complete a session"""
    session_id: str
    force_complete: bool = False  # Allow completing even if not all items scanned
