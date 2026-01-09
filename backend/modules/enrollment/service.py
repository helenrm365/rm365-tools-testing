# Replace the imports section in backend/modules/enrollment/service.py

from __future__ import annotations
import base64
from typing import Dict, Any, Optional

from common.utils import next_employee_code
from .repo import EnrollmentRepo

# Optional hardware imports - gracefully handle missing hardware modules
try:
    from .hardware.nfc_reader import read_nfc_uid
    NFC_READER_AVAILABLE = True
except ImportError:
    NFC_READER_AVAILABLE = False
    def read_nfc_uid():
        raise RuntimeError("NFC reader hardware not available in this environment")


class EnrollmentService:
    def __init__(self, repo: Optional[EnrollmentRepo] = None):
        self.repo = repo or EnrollmentRepo()

    # ---- Queries ----
    def list_employees(self):
        return self.repo.list_employees()

    # ---- Create/Update/Delete ----
    def create_employee(self, *, name: str, location: str | None, status: str | None, nfc_uid: str | None):
        last = self.repo.get_last_employee_code()
        code = next_employee_code(last)
        row = self.repo.create_employee(name=name, location=location, status=status,
                                        employee_code=code, nfc_uid=nfc_uid)
        return {"status": "success", "employee": row}

    def update_employee(self, employee_id: int, **fields):
        row = self.repo.update_employee(employee_id, **fields)
        return {"status": "success", "employee": row}

    def delete_employee(self, employee_id: int):
        try:
            deleted = self.repo.delete_employee(employee_id)
            
            return {"status": "success" if deleted else "noop", "deleted": deleted}
        except Exception as e:
            print(f"[Service] Delete employee error: {e}")
            raise

    def bulk_delete(self, ids: list[int]):
        try:
            if not ids:
                return {"status": "noop", "deleted": 0}
            
            deleted = self.repo.bulk_delete(ids)
            
            return {"status": "success", "deleted": deleted}
        except Exception as e:
            print(f"[Service] Bulk delete error: {e}")
            raise

    # ---- NFC ----
    def scan_nfc(self) -> Dict[str, Any]:
        if not NFC_READER_AVAILABLE:
            return {"status": "error", "uid": None, "detail": "NFC reader hardware not available in this environment"}
        
        try:
            uid = read_nfc_uid()
        except Exception as e:
            return {"status": "error", "uid": None, "detail": str(e)}
        return {"status": "scanned", "uid": uid}

    def save_nfc(self, employee_id: int, uid: str):
        try:
            self.repo.save_nfc_uid(employee_id, uid)
            return {"status": "success", "employee_id": employee_id, "uid": uid}
        except ValueError as e:
            return {"status": "error", "detail": str(e)}
        except Exception as e:
            return {"status": "error", "detail": f"Failed to save NFC: {str(e)}"}

    def delete_nfc(self, employee_id: int):
        try:
            self.repo.delete_nfc_uid(employee_id)
            return {"status": "success", "employee_id": employee_id}
        except ValueError as e:
            return {"status": "error", "detail": str(e)}
        except Exception as e:
            return {"status": "error", "detail": f"Failed to delete NFC: {str(e)}"}
