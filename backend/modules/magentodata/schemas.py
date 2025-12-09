from pydantic import BaseModel
from typing import Optional, List, Dict, Any
from datetime import datetime


class MagentoDataRow(BaseModel):
    """Schema for a single magento data row"""
    id: Optional[int] = None
    order_number: str
    created_at: str
    sku: str
    name: str
    qty: int
    original_price: Optional[float] = None
    special_price: Optional[float] = None
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


class MagentoDataResponse(BaseModel):
    """Response for getting magento data"""
    status: str
    region: Optional[str] = None
    data: List[Dict[str, Any]]
    total_count: int
    limit: Optional[int] = None
    offset: Optional[int] = None
    message: Optional[str] = None


class MagentoDataImportResponse(BaseModel):
    """Response for magento data import operations"""
    status: str
    message: str
    rows_imported: Optional[int] = None
    errors: Optional[List[str]] = None


class MagentoSyncRequest(BaseModel):
    """Request body for syncing live Magento data"""
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    max_orders: Optional[int] = None
    resync_days: Optional[int] = 7  # Number of days to re-sync to catch status/qty changes


class MagentoSyncResponse(BaseModel):
    """Response for Magento data sync operations"""
    status: str
    message: str
    rows_synced: Optional[int] = None
    orders_processed: Optional[int] = None
    errors: Optional[List[str]] = None
    progress: Optional[str] = None  # Progress indicator (e.g., "Processing page 5...")
    is_complete: Optional[bool] = None  # Whether sync is fully complete


class ImportHistoryResponse(BaseModel):
    """Response for import history"""
    status: str
    data: List[Dict[str, Any]]
    total_count: int
    limit: Optional[int] = None
    offset: Optional[int] = None
    message: Optional[str] = None
