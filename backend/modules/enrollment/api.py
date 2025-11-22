from __future__ import annotations
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException

from common.deps import get_current_user
from common.dto import (
    EmployeeOut, EnrollResponse, ScanCardResponse, FingerprintScanResponse, BulkDeleteResult
)
from .schemas import (
    EmployeeCreateIn, EmployeeUpdateIn, SaveCardIn, SaveFingerprintIn, BulkDeleteIn, DeleteFingerprintIn
)
from .service import EnrollmentService

router = APIRouter()

def _svc() -> EnrollmentService:
    return EnrollmentService()

# ---- Employees ----
@router.get("/employees", response_model=List[EmployeeOut])
def list_employees(user=Depends(get_current_user)):
    rows = _svc().list_employees()
    # map rows (dicts) into EmployeeOut; unknown keys are ignored
    return [EmployeeOut(**row) for row in rows]

@router.post("/employees", response_model=EnrollResponse)
def create_employee(body: EmployeeCreateIn, user=Depends(get_current_user)):
    result = _svc().create_employee(
        name=body.name, location=body.location, status=body.status, card_uid=body.card_uid
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
        
        print(f"[Bulk Delete] Received request to delete IDs: {body.ids}")
        result = _svc().bulk_delete(body.ids)
        print(f"[Bulk Delete] Service result: {result}")
        
        return BulkDeleteResult(status=result["status"], deleted=result["deleted"])
    except Exception as e:
        print(f"[Bulk Delete] Error: {e}")
        raise HTTPException(status_code=500, detail=f"Bulk delete failed: {str(e)}")

# ---- Card ----
@router.post("/scan/card", response_model=ScanCardResponse)
def scan_card(user=Depends(get_current_user)):
    result = _svc().scan_card()
    # status: 'scanned' or 'error'; uid may be None
    return ScanCardResponse(status=result["status"], uid=result.get("uid"))

@router.post("/save/card")
def save_card(body: SaveCardIn, user=Depends(get_current_user)):
    return _svc().save_card(body.employee_id, body.uid)

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
