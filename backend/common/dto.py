# common/dto.py
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field


# ---------------------------
# Generic envelopes
# ---------------------------
class Detail(BaseModel):
    detail: str


class Status(BaseModel):
    status: str = Field(..., description="e.g. 'success', 'error', 'noop', 'scanned'")


class SuccessErrorCount(BaseModel):
    success_count: int
    error_count: int


# ---------------------------
# Sales data (CSV uploads)
# ---------------------------
# /salesdata/upload -> {"detail": "..."}  (already covered by Detail)
# :contentReference[oaicite:1]{index=1}


# ---------------------------
# Labels
# ---------------------------
class LabelJobResult(BaseModel):
    # Keep this flexible since run_label_generation() returns a dict today.
    # If you formalise fields later, update here.
    message: Optional[str] = None
    filename: Optional[str] = None
    ok: Optional[bool] = None
    # Add extra fields without validation errors
    class Config:
        extra = "allow"
# :contentReference[oaicite:2]{index=2}


# ---------------------------
# Inventory: adjustments sync & logging
# ---------------------------
class InventorySyncResult(SuccessErrorCount):
    """/inventory/adjustments/sync -> success/error counts."""
    pass
# :contentReference[oaicite:3]{index=3}

class LogInventoryAdjustmentIn(BaseModel):
    barcode: str
    quantity: int
    reason: str
    field: str  # "shelf_lt1_qty" | "shelf_gt1_qty" | "top_floor_total"
# :contentReference[oaicite:4]{index=4}


# ---------------------------
# Inventory management
# ---------------------------
class InventoryItemCustomFields(BaseModel):
    shelf_total: Optional[int] = None
    reserve_stock: Optional[int] = None


class InventoryItemOut(BaseModel):
    item_id: str
    product_name: str
    sku: str
    stock_on_hand: Optional[int] = None
    custom_fields: InventoryItemCustomFields
# :contentReference[oaicite:5]{index=5}


class InventoryMetadataRecord(BaseModel):
    """
    /inventory/management/metadata returns raw table rows.
    Allow arbitrary fields so it matches your SELECT * today.
    """
    class Config:
        extra = "allow"
# :contentReference[oaicite:6]{index=6}


class InventoryMetadataUpsertIn(BaseModel):
    item_id: str  # Changed from int to str to match Zoho item IDs
    location: Optional[str] = None
    date: Optional[str] = None  # ISO string as used now
    shelf_lt1: Optional[str] = None
    shelf_lt1_qty: int = 0
    shelf_gt1: Optional[str] = None
    shelf_gt1_qty: int = 0
    top_floor_expiry: Optional[str] = None
    top_floor_total: int = 0
# :contentReference[oaicite:7]{index=7}


class LiveSyncResult(BaseModel):
    detail: str
    new_stock_on_hand: Optional[int] = None
    stock_on_hand: Optional[int] = None
# :contentReference[oaicite:8]{index=8}


# ---------------------------
# Enrollment
# ---------------------------
class EmployeeOut(BaseModel):
    id: int
    name: str
    employee_code: Optional[str] = None
    location: Optional[str] = None
    status: Optional[str] = None
    card_uid: Optional[str] = None
    has_fingerprint: Optional[bool] = None
# :contentReference[oaicite:9]{index=9}


class EnrollResponse(BaseModel):
    status: str = "success"
    employee: EmployeeOut
# :contentReference[oaicite:10]{index=10}


class ScanCardResponse(Status):
    uid: Optional[str] = None  # status: 'scanned'
# :contentReference[oaicite:11]{index=11}


class FingerprintScanResponse(Status):
    template_b64: Optional[str] = None  # status: 'scanned'
# :contentReference[oaicite:12]{index=12}


class UpdateEmployeeIn(BaseModel):
    name: Optional[str] = None
    location: Optional[str] = None
    status: Optional[str] = None
    card_uid: Optional[str] = None
# :contentReference[oaicite:13]{index=13}


class BulkDeleteIn(BaseModel):
    ids: List[int]


class BulkDeleteResult(Status):
    deleted: int = 0
# :contentReference[oaicite:14]{index=14}


class MatchEmployee(BaseModel):
    id: int
    name: str
    score: int


class FingerClockResult(Status):
    message: str
    employee: MatchEmployee
    direction: str  # 'IN' | 'OUT'
# :contentReference[oaicite:15]{index=15}


# ---------------------------
# Attendance
# ---------------------------
class AttendanceEmployeeBrief(BaseModel):
    id: int
    name: str
    card_uid: Optional[str] = None
# :contentReference[oaicite:16]{index=16}


class ClockRequest(BaseModel):
    employee_id: int


class ClockResponse(Status):
    direction: str
# :contentReference[oaicite:17]{index=17}


class AttendanceSummaryItem(BaseModel):
    name: str
    count: int
# :contentReference[oaicite:18]{index=18}
