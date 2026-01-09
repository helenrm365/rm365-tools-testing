from pydantic import BaseModel

class ClockRequest(BaseModel):
    employee_id: int
