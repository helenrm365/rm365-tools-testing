from __future__ import annotations
from typing import Optional, List, Dict, Any
from datetime import date
from pydantic import BaseModel, Field


class LabelRequest(BaseModel):
    start_date: date = Field(..., description="Start date for data filtering")
    end_date: date = Field(..., description="End date for data filtering") 
    search: Optional[str] = Field(None, description="Search term for filtering")
    format: Optional[str] = Field("csv", description="Output format (csv, shipping, product)")


class LabelDataResponse(BaseModel):
    status: str
    data: List[Dict[str, Any]]
    count: int
    message: Optional[str] = None


class LabelGenerateResponse(BaseModel):
    status: str
    content: Optional[str] = None
    count: Optional[int] = None
    generated_at: Optional[str] = None
    message: Optional[str] = None


class LabelRunHistory(BaseModel):
    id: int
    run_date: str
    start_date: str
    end_date: str
    search_term: Optional[str] = None
    labels_count: int
    status: str


class RecentRunsResponse(BaseModel):
    status: str = "success"
    runs: List[LabelRunHistory]


class SalesOrderCreate(BaseModel):
    order_number: str = Field(..., description="Unique order number")
    customer_name: str = Field(..., description="Customer name")
    customer_address: Optional[str] = Field(None, description="Customer address")
    product_sku: str = Field(..., description="Product SKU")
    product_name: str = Field(..., description="Product name")
    quantity: int = Field(1, description="Quantity ordered")
    order_date: date = Field(..., description="Order date")
    shipping_method: Optional[str] = Field("Standard", description="Shipping method")


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