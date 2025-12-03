from pydantic import BaseModel
from typing import Optional, List

# Inputs
class EmployeeCreateIn(BaseModel):
    name: str
    location: Optional[str] = None
    status: Optional[str] = None
    nfc_uid: Optional[str] = None  # optional at creation

class EmployeeUpdateIn(BaseModel):
    name: Optional[str] = None
    location: Optional[str] = None
    status: Optional[str] = None
    nfc_uid: Optional[str] = None

class SaveNFCIn(BaseModel):
    employee_id: int
    uid: str

class DeleteNFCIn(BaseModel):
    employee_id: int

class SaveFingerprintIn(BaseModel):
    employee_id: int
    template_b64: str
    name: str = "Default"

class DeleteFingerprintIn(BaseModel):
    fingerprint_id: int

class BulkDeleteIn(BaseModel):
    ids: List[int]

# Outputs (use common/dto for shapes the frontend already expects)
from common.dto import (
    EmployeeOut, EnrollResponse, ScanNFCResponse, FingerprintScanResponse,
    BulkDeleteResult
)
