from pydantic import BaseModel
from typing import Optional, List, Dict, Any
from datetime import datetime


class SalesDataRow(BaseModel):
    """Schema for a single sales data row"""
    id: Optional[int] = None
    order_number: str
    created_at: str
    sku: str
    name: str
    qty: int
    price: float
    status: str
    imported_at: Optional[str] = None
    updated_at: Optional[str] = None


class InitTablesResponse(BaseModel):
    """Response for table initialization"""
    status: str
    message: str
    tables: List[str]


class SalesDataResponse(BaseModel):
    """Response for getting sales data"""
    status: str
    region: Optional[str] = None
    data: List[Dict[str, Any]]
    total_count: int
    limit: Optional[int] = None
    offset: Optional[int] = None
    message: Optional[str] = None


class SalesImportResponse(BaseModel):
    """Response for sales import operations"""
    status: str
    message: str
    rows_imported: Optional[int] = None
    errors: Optional[List[str]] = None
