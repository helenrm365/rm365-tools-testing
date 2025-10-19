from __future__ import annotations
from typing import Optional
from pydantic import BaseModel


# Input schemas for inventory management
class InventoryMetadataCreateIn(BaseModel):
    item_id: str
    location: Optional[str] = None
    date: Optional[str] = None
    uk_6m_data: Optional[str] = None
    shelf_lt1: Optional[str] = None
    shelf_lt1_qty: Optional[int] = 0
    shelf_gt1: Optional[str] = None
    shelf_gt1_qty: Optional[int] = 0
    top_floor_expiry: Optional[str] = None
    top_floor_total: Optional[int] = 0
    status: Optional[str] = "Active"
    uk_fr_preorder: Optional[str] = None
    fr_6m_data: Optional[str] = None


class InventoryMetadataUpdateIn(BaseModel):
    location: Optional[str] = None
    date: Optional[str] = None
    uk_6m_data: Optional[str] = None
    shelf_lt1: Optional[str] = None
    shelf_lt1_qty: Optional[int] = None
    shelf_gt1: Optional[str] = None
    shelf_gt1_qty: Optional[int] = None
    top_floor_expiry: Optional[str] = None
    top_floor_total: Optional[int] = None
    status: Optional[str] = None
    uk_fr_preorder: Optional[str] = None
    fr_6m_data: Optional[str] = None


class LiveSyncIn(BaseModel):
    item_id: str
    new_quantity: int
    reason: Optional[str] = "Inventory Re-evaluation"


# Use common DTOs for outputs
from common.dto import (
    InventoryItemOut, InventoryMetadataRecord, InventoryMetadataUpsertIn, LiveSyncResult
)
