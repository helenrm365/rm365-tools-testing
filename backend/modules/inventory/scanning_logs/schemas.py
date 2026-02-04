"""
Pydantic schemas for scanning logs
"""
from __future__ import annotations
from typing import List, Optional
from datetime import datetime
from pydantic import BaseModel


class ScannerSubmissionItem(BaseModel):
    """Single item within a submission"""
    sku: str
    item_id: Optional[str] = None
    product_name: Optional[str] = None
    quantity: int  # Signed: negative = remove, positive = add
    shelf_field: str  # auto, shelf_lt1_qty, shelf_gt1_qty, top_floor_total
    # For auto logic - breakdown of where stock was taken from/added to
    allocation_details: Optional[List[dict]] = None  # [{field, qty}]


class CreateSubmissionRequest(BaseModel):
    """Request to create a new scanner submission log"""
    reason: str
    items: List[ScannerSubmissionItem]


class SubmissionItemOut(BaseModel):
    """Output schema for a submission item"""
    id: int
    submission_id: int
    sku: str
    item_id: Optional[str]
    product_name: Optional[str]
    quantity: int
    shelf_field: str
    allocation_details: Optional[List[dict]]


class SubmissionOut(BaseModel):
    """Output schema for a submission"""
    id: int
    branch: str
    reason: str
    submitted_by: str
    submitted_at: datetime
    total_items: int
    total_added: int
    total_removed: int
    items: List[SubmissionItemOut]


class SubmissionListItem(BaseModel):
    """Summary of a submission for list view"""
    id: int
    branch: str
    reason: str
    submitted_by: str
    submitted_at: datetime
    total_items: int
    total_added: int
    total_removed: int


class SubmissionListResponse(BaseModel):
    """Paginated list of submissions"""
    submissions: List[SubmissionListItem]
    total: int
    page: int
    per_page: int
    total_pages: int


class LogSearchParams(BaseModel):
    """Search parameters for logs"""
    branch: Optional[str] = None
    search: Optional[str] = None  # SKU, item_id, or product name
    user: Optional[str] = None
    date_from: Optional[datetime] = None
    date_to: Optional[datetime] = None
    page: int = 1
    per_page: int = 20
