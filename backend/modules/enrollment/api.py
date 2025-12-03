from __future__ import annotations
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException

from common.deps import get_current_user
from common.dto import (
    EmployeeOut, EnrollResponse, ScanNFCResponse, FingerprintScanResponse, BulkDeleteResult
)
from .schemas import (
    EmployeeCreateIn, EmployeeUpdateIn, SaveNFCIn, DeleteNFCIn, SaveFingerprintIn, BulkDeleteIn, DeleteFingerprintIn
)
from .service import EnrollmentService

router = APIRouter()

def _svc() -> EnrollmentService:
    return EnrollmentService()

# ---- Employees ----
@router.get("/employees", response_model=List[EmployeeOut])
def list_employees(user=Depends(get_current_user)):
    try:
        rows = _svc().list_employees()
        # map rows (dicts) into EmployeeOut; unknown keys are ignored
        return [EmployeeOut(**row) for row in rows]
    except ValueError as e:
        # Database not configured - return empty list for demo mode
        print(f"[Enrollment] Database not configured: {e}")
        return []
    except Exception as e:
        # Database connection failed - return empty list for demo mode
        print(f"[Enrollment] Database error: {e}")
        return []

@router.post("/employees", response_model=EnrollResponse)
def create_employee(body: EmployeeCreateIn, user=Depends(get_current_user)):
    result = _svc().create_employee(
        name=body.name, location=body.location, status=body.status, nfc_uid=body.nfc_uid
    )
    return EnrollResponse(employee=EmployeeOut(**result["employee"]))

@router.patch("/employees/{employee_id}", response_model=EnrollResponse)
def update_employee(employee_id: int, body: EmployeeUpdateIn, user=Depends(get_current_user)):
    result = _svc().update_employee(employee_id, **body.model_dump(exclude_unset=True))
    return EnrollResponse(employee=EmployeeOut(**result["employee"]))

@router.delete("/employees/{employee_id}", response_model=BulkDeleteResult)
def delete_employee(employee_id: int, user=Depends(get_current_user)):
    result = _svc().delete_employee(employee_id)
    return BulkDeleteResult(status=result["status"], deleted=result["deleted"])

@router.post("/employees/bulk-delete", response_model=BulkDeleteResult)
def bulk_delete(body: BulkDeleteIn, user=Depends(get_current_user)):
    try:
        if not body.ids:
            return BulkDeleteResult(status="noop", deleted=0)
        
        result = _svc().bulk_delete(body.ids)
        
        return BulkDeleteResult(status=result["status"], deleted=result["deleted"])
    except Exception as e:
        print(f"[Bulk Delete] Error: {e}")
        raise HTTPException(status_code=500, detail=f"Bulk delete failed: {str(e)}")

# ---- NFC ----
@router.post("/scan/nfc", response_model=ScanNFCResponse)
def scan_nfc(user=Depends(get_current_user)):
    result = _svc().scan_nfc()
    # status: 'scanned' or 'error'; uid may be None
    return ScanNFCResponse(status=result["status"], uid=result.get("uid"))

@router.post("/save/nfc")
def save_nfc(body: SaveNFCIn, user=Depends(get_current_user)):
    return _svc().save_nfc(body.employee_id, body.uid)

@router.post("/delete/nfc")
def delete_nfc(body: DeleteNFCIn, user=Depends(get_current_user)):
    return _svc().delete_nfc(body.employee_id)

# ---- Fingerprint ----
@router.post("/scan/fingerprint", response_model=FingerprintScanResponse)
def scan_fingerprint(user=Depends(get_current_user)):
    result = _svc().scan_fingerprint()
    return FingerprintScanResponse(status=result["status"], template_b64=result.get("template_b64"))

@router.post("/save/fingerprint")
def save_fingerprint(body: SaveFingerprintIn, user=Depends(get_current_user)):
    return _svc().save_fingerprint(body.employee_id, body.template_b64, body.name)

@router.post("/delete/fingerprint")
def delete_fingerprint(body: DeleteFingerprintIn, user=Depends(get_current_user)):
    return _svc().delete_fingerprint(body.fingerprint_id)
