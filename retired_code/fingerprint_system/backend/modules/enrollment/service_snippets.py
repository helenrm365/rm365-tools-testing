from typing import Dict, Any
import base64

try:
    from .hardware.fingerprint_reader import read_fingerprint_template, FingerprintCaptureError
    FINGERPRINT_READER_AVAILABLE = True
except ImportError:
    FINGERPRINT_READER_AVAILABLE = False
    class FingerprintCaptureError(Exception):
        pass
    def read_fingerprint_template(timeout=8000):
        raise RuntimeError("Fingerprint reader hardware not available in this environment")

class EnrollmentServiceSnippet:
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

    def save_fingerprint(self, employee_id: int, template_b64: str, name: str = "Default"):
        tpl = base64.b64decode(template_b64.encode("ascii"))
        self.repo.save_fingerprint(employee_id, tpl, name)
        return {"status": "success", "employee_id": employee_id}

    def delete_fingerprint(self, fingerprint_id: int):
        self.repo.delete_fingerprint(fingerprint_id)
        return {"status": "success", "fingerprint_id": fingerprint_id}
