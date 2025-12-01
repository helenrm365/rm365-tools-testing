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
    subtotal: Optional[float] = None
    tax_amount: Optional[float] = None
    order_currency_code: Optional[str] = None
    created_at: str
    order_date: Optional[str] = None
    items: List[InvoiceItemSchema]
    # Billing (Sold To)
    billing_name: Optional[str] = None
    billing_address: Optional[str] = None
    billing_postcode: Optional[str] = None
    billing_phone: Optional[str] = None
    # Shipping (Ship To)
    shipping_name: Optional[str] = None
    shipping_address: Optional[str] = None
    shipping_postcode: Optional[str] = None
    shipping_phone: Optional[str] = None
    # Order details
    payment_method: Optional[str] = None
    shipping_method: Optional[str] = None


class ScanRequestSchema(BaseModel):
    """Request to scan a product"""
    session_id: str
    sku: str
    quantity: float = 1.0
    field: str = "auto"  # auto, shelf_lt1_qty, shelf_gt1_qty, top_floor_total


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
    # Order details for display
    grand_total: Optional[float] = None
    subtotal: Optional[float] = None
    tax_amount: Optional[float] = None
    order_currency_code: Optional[str] = None
    order_date: Optional[str] = None
    billing_name: Optional[str] = None
    billing_postcode: Optional[str] = None
    billing_phone: Optional[str] = None
    shipping_name: Optional[str] = None
    shipping_postcode: Optional[str] = None
    shipping_phone: Optional[str] = None
    payment_method: Optional[str] = None
    shipping_method: Optional[str] = None


class CompleteSessionSchema(BaseModel):
    """Schema to complete a session"""
    session_id: str
    force_complete: bool = False  # Allow completing even if not all items scanned


class SessionOwnershipSchema(BaseModel):
    """Session ownership information"""
    session_id: str
    current_owner: Optional[str] = None
    created_by: Optional[str] = None
    status: str  # draft, in_progress, completed, cancelled
    can_access: bool
    can_take_over: bool
    message: Optional[str] = None


class TakeoverRequestSchema(BaseModel):
    """Request to take over a session"""
    session_id: str


class TakeoverResponseSchema(BaseModel):
    """Response to takeover request"""
    request_id: str
    accept: bool  # True to accept, False to decline


class SessionUserSchema(BaseModel):
    """Active user in a session context"""
    username: str
    session_id: Optional[str] = None
    is_online: bool = True
    last_seen: datetime = Field(default_factory=datetime.now)


class SessionAuditLogSchema(BaseModel):
    """Audit log entry for session actions"""
    timestamp: datetime
    action: str  # started, drafted, cancelled, completed, claimed, transferred, forced_takeover
    user: str
    details: Optional[str] = None


class DashboardSessionSchema(BaseModel):
    """Session information for dashboard view"""
    session_id: str
    order_number: str
    invoice_number: str
    status: str  # draft, in_progress, completed, cancelled
    session_type: str
    current_owner: Optional[str] = None
    created_by: str
    created_at: datetime
    last_modified_by: Optional[str] = None
    last_modified_at: Optional[datetime] = None
    progress_percentage: float
    items_expected: int
    items_scanned: int
    audit_logs: List[SessionAuditLogSchema] = []


class ForceAssignSchema(BaseModel):
    """Force assign a session to another user"""
    target_user_id: str


class ForceCancelSchema(BaseModel):
    """Force cancel a session"""
    reason: Optional[str] = None

