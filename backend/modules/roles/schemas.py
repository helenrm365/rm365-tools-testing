from pydantic import BaseModel, Field
from typing import List, Optional
from datetime import datetime

class RoleOut(BaseModel):
    id: int
    role_name: str
    allowed_tabs: List[str] = Field(default_factory=list)
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

class RoleCreate(BaseModel):
    role_name: str
    allowed_tabs: List[str] = Field(default_factory=list)

class RoleUpdate(BaseModel):
    role_name: str  # key
    new_role_name: Optional[str] = None
    allowed_tabs: Optional[List[str]] = None
