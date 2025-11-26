from __future__ import annotations
from datetime import datetime
from typing import Optional, List, Union
from pydantic import BaseModel, field_validator


class MagentoProduct(BaseModel):
    """Product item from Magento invoice"""
    sku: str
    name: str
    qty_ordered: float
    qty_invoiced: float
    price: float
    row_total: float
    product_id: Optional[int] = None


class MagentoInvoice(BaseModel):
    """Magento invoice data model"""
    entity_id: int
    increment_id: str  # Invoice number (e.g., "000000123")
    order_id: int
    order_increment_id: str  # Order number
    state: Union[str, int]  # Magento returns this as int (1=pending, 2=paid, etc.) or string
    grand_total: float
    created_at: str
    items: List[MagentoProduct] = []
    
    # Billing address
    billing_name: Optional[str] = None
    billing_street: Optional[str] = None
    billing_city: Optional[str] = None
    billing_postcode: Optional[str] = None
    billing_country: Optional[str] = None
    
    @field_validator('state')
    @classmethod
    def convert_state_to_string(cls, v):
        """Convert state to string if it's an integer"""
        if isinstance(v, int):
            state_map = {1: 'pending', 2: 'paid', 3: 'canceled'}
            return state_map.get(v, str(v))
        return v


class ScanSession(BaseModel):
    """Track scanning session for pick/pack"""
    session_id: str
    invoice_id: str
    order_number: str
    session_type: str  # "pick" or "return"
    started_at: datetime
    completed_at: Optional[datetime] = None
    items_expected: List[dict] = []
    items_scanned: List[dict] = []
    status: str = "in_progress"  # in_progress, completed, cancelled
    user_id: Optional[str] = None
