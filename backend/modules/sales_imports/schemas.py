from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime


class SalesDataRow(BaseModel):
    """Schema for a single sales data row"""
    order_number: str
    created_at: str
    sku: str
    name: str
    qty: int
    price: float
    status: str
    imported_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class InitTablesResponse(BaseModel):
    """Response for table initialization"""
    status: str
    message: str
    tables: List[str]


class SalesImportResponse(BaseModel):
    """Response for sales import operations"""
    status: str
    message: str
    rows_imported: Optional[int] = None
