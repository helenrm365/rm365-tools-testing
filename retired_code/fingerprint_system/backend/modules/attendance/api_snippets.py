from .schemas import FingerClockRequest
from fastapi import APIRouter, Depends

router = APIRouter()

@router.get("/employees/templates")
def list_employee_templates(user=Depends(get_current_user)):
    """Get all employee fingerprint templates for client-side matching."""
    return _svc().get_employee_templates()

@router.post("/clock-by-fingerprint")
def clock_by_fingerprint(body: FingerClockRequest, user=Depends(get_current_user)):
    return _svc().clock_by_fingerprint(body.template_b64)
