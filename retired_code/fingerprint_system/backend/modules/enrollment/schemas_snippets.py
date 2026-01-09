from pydantic import BaseModel

class SaveFingerprintIn(BaseModel):
    employee_id: int
    template_b64: str
    name: str = "Default"

class DeleteFingerprintIn(BaseModel):
    fingerprint_id: int
