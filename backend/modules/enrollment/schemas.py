from pydantic import BaseModel
from typing import Optional, List

# Inputs
class EmployeeCreateIn(BaseModel):
    name: str
    location: Optional[str] = None
    status: Optional[str] = None
    card_uid: Optional[str] = None  # optional at creation

class EmployeeUpdateIn(BaseModel):
    name: Optional[str] = None
    location: Optional[str] = None
    status: Optional[str] = None
    card_uid: Optional[str] = None

class SaveCardIn(BaseModel):
    employee_id: int
    uid: str

class SaveFingerprintIn(BaseModel):
    employee_id: int
    template_b64: str

class BulkDeleteIn(BaseModel):
    ids: List[int]

# Outputs (use common/dto for shapes the frontend already expects)
from common.dto import (
    EmployeeOut, EnrollResponse, ScanCardResponse, FingerprintScanResponse,
    BulkDeleteResult
)
