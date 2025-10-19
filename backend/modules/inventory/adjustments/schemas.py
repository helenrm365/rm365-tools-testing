from __future__ import annotations
from typing import Optional, List, Dict, Any
from datetime import datetime
from pydantic import BaseModel, Field


# Input schemas for adjustments
class AdjustmentLogIn(BaseModel):
    barcode: str = Field(..., description="Barcode/item ID")
    quantity: int = Field(..., description="Quantity to adjust")
    reason: str = Field(..., description="Reason for adjustment")
    field: str = Field(..., description="Field to affect: shelf_lt1_qty, shelf_gt1_qty, or top_floor_total")


# Legacy input schema for compatibility
class AdjustmentCreateIn(BaseModel):
    """Legacy schema - kept for compatibility"""
    item_id: int = Field(..., description="ID of the inventory item")
    adjustment_type: str = Field(..., description="Type of adjustment: in, out, transfer, correction")
    quantity: int = Field(..., description="Quantity to adjust")
    reason: Optional[str] = Field(None, description="Reason for adjustment")


# Output schemas
class AdjustmentOut(BaseModel):
    id: int
    barcode: str
    quantity: int
    reason: str
    field: str
    status: Optional[str] = None
    response_message: Optional[str] = None
    created_at: Optional[str] = None


class AdjustmentHistoryResponse(BaseModel):
    item_id: str  # Changed to string for barcode
    adjustments: List[Dict[str, Any]]
    count: int


class AdjustmentSummary(BaseModel):
    total_adjustments: int
    status_breakdown: Dict[str, Dict[str, int]]
    date_range: Dict[str, str]


# Use common DTOs for shared outputs
from common.dto import LogInventoryAdjustmentIn, InventorySyncResult
