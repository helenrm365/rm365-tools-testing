from pydantic import BaseModel

class FingerClockRequest(BaseModel):
    template_b64: str  # ANSI-378 probe template, base64-encoded
