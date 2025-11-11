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
    currency: Optional[str] = None
    grand_total: Optional[float] = None
    customer_email: Optional[str] = None
    customer_full_name: Optional[str] = None
    billing_address: Optional[str] = None
    shipping_address: Optional[str] = None
    customer_group_code: Optional[str] = None
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


class SalesDataImportResponse(BaseModel):
    """Response for sales data import operations"""
    status: str
    message: str
    rows_imported: Optional[int] = None
    errors: Optional[List[str]] = None


class ImportHistoryResponse(BaseModel):
    """Response for import history"""
    status: str
    data: List[Dict[str, Any]]
    total_count: int
    limit: Optional[int] = None
    offset: Optional[int] = None
    message: Optional[str] = None
