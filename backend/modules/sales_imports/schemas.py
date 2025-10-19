from __future__ import annotations
from typing import Optional, List, Dict, Any
from datetime import date
from pydantic import BaseModel, Field


class ImportResponse(BaseModel):
    status: str
    imported_count: Optional[int] = None
    total_rows: Optional[int] = None
    errors: Optional[List[str]] = None
    has_errors: Optional[bool] = None
    message: Optional[str] = None


class ValidationResponse(BaseModel):
    valid: bool
    message: str
    total_rows: Optional[int] = None
    columns: Optional[List[str]] = None
    required_columns: Optional[List[str]] = None
    available_columns: Optional[List[str]] = None


class SalesOrderOut(BaseModel):
    id: int
    order_number: str
    customer_name: str
    customer_address: Optional[str] = None
    product_sku: str
    product_name: str
    quantity: int
    order_date: str
    shipping_method: Optional[str] = None
    created_at: Optional[str] = None


class SalesOrdersResponse(BaseModel):
    status: str = "success"
    orders: List[SalesOrderOut]
    count: int


class ImportHistoryItem(BaseModel):
    id: int
    import_date: str
    filename: str
    total_rows: int
    imported_rows: int
    errors_count: int
    status: str


class ImportHistoryResponse(BaseModel):
    status: str = "success"
    history: List[ImportHistoryItem]


class DeleteResponse(BaseModel):
    status: str
    message: str


class UKSalesDataOut(BaseModel):
    id: int
    order_number: str                    # Order #
    created_at: str                       # Created At
    sku: str                              # SKU
    name: str                             # Name
    qty: int                              # Qty
    price: float                          # Price
    status: Optional[str] = None          # Status


class UKSalesDataResponse(BaseModel):
    status: str = "success"
    data: List[UKSalesDataOut]
    count: int
    total: int