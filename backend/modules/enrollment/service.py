# Replace the imports section in backend/modules/enrollment/service.py

from __future__ import annotations
import base64
from typing import Dict, Any, Optional

from common.utils import next_employee_code
from .repo import EnrollmentRepo

# Optional hardware imports - gracefully handle missing hardware modules
try:
    from backend.modules.enrollment.hardware.card_reader import read_card_uid
    CARD_READER_AVAILABLE = True
except ImportError:
    CARD_READER_AVAILABLE = False
    def read_card_uid():
        raise RuntimeError("Card reader hardware not available in this environment")

try:
    from backend.modules.enrollment.hardware.fingerprint_reader import read_fingerprint_template, FingerprintCaptureError
    FINGERPRINT_READER_AVAILABLE = True
except ImportError:
    FINGERPRINT_READER_AVAILABLE = False
    class FingerprintCaptureError(Exception):
        pass
    def read_fingerprint_template(timeout=8000):
        raise RuntimeError("Fingerprint reader hardware not available in this environment")


class EnrollmentService:
    def __init__(self, repo: Optional[EnrollmentRepo] = None):
        self.repo = repo or EnrollmentRepo()

    # ---- Queries ----
    def list_employees(self):
        return self.repo.list_employees()

    # ---- Create/Update/Delete ----
    def create_employee(self, *, name: str, location: str | None, status: str | None, card_uid: str | None):
        last = self.repo.get_last_employee_code()
        code = next_employee_code(last)
        row = self.repo.create_employee(name=name, location=location, status=status,
                                        employee_code=code, card_uid=card_uid)
        return {"status": "success", "employee": row}

    def update_employee(self, employee_id: int, **fields):
        row = self.repo.update_employee(employee_id, **fields)
        return {"status": "success", "employee": row}

    def delete_employee(self, employee_id: int):
        try:
            print(f"[Service] Delete employee called for ID: {employee_id}")
            deleted = self.repo.delete_employee(employee_id)
            print(f"[Service] Deleted employee {employee_id} (and related attendance logs)")
            
            return {"status": "success" if deleted else "noop", "deleted": deleted}
        except Exception as e:
            print(f"[Service] Delete employee error: {e}")
            raise

    def bulk_delete(self, ids: list[int]):
        try:
            if not ids:
                return {"status": "noop", "deleted": 0}
            
            print(f"[Service] Bulk delete called with IDs: {ids}")
            deleted = self.repo.bulk_delete(ids)
            print(f"[Service] Deleted {deleted} employees (and related attendance logs)")
            
            return {"status": "success", "deleted": deleted}
        except Exception as e:
            print(f"[Service] Bulk delete error: {e}")
            raise

    # ---- Card ----
    def scan_card(self) -> Dict[str, Any]:
        if not CARD_READER_AVAILABLE:
            return {"status": "error", "uid": None, "detail": "Card reader hardware not available in this environment"}
        
        try:
            uid = read_card_uid()
        except Exception as e:
            return {"status": "error", "uid": None, "detail": str(e)}
        return {"status": "scanned", "uid": uid}

    def save_card(self, employee_id: int, uid: str):
        self.repo.save_card_uid(employee_id, uid)
        return {"status": "success", "employee_id": employee_id, "uid": uid}

    # ---- Fingerprint ----
    def scan_fingerprint(self) -> Dict[str, Any]:
        if not FINGERPRINT_READER_AVAILABLE:
            return {"status": "error", "template_b64": None, "detail": "Fingerprint reader hardware not available in this environment"}
        
        try:
            tpl: bytes = read_fingerprint_template(timeout=8000)
        except FingerprintCaptureError as e:
            # Device present but scan failed: keep message, map to error status
            return {"status": "error", "template_b64": None, "detail": str(e)}
        except Exception as e:
            # Device/service not available in this environment (e.g., server)
            return {"status": "error", "template_b64": None, "detail": str(e)}
        tpl_b64 = base64.b64encode(tpl).decode("ascii")
        return {"status": "scanned", "template_b64": tpl_b64}

    def save_fingerprint(self, employee_id: int, template_b64: str):
        tpl = base64.b64decode(template_b64.encode("ascii"))
        self.repo.save_fingerprint(employee_id, tpl)
        return {"status": "success", "employee_id": employee_id}