from typing import Optional
from .dto import Status

class FingerprintScanResponse(Status):
    template_b64: Optional[str] = None  # status: 'scanned'
