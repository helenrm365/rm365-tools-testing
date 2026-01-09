from common.dto import FingerprintScanResponse
from .schemas import SaveFingerprintIn, DeleteFingerprintIn
from fastapi import APIRouter, Depends

router = APIRouter()

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
