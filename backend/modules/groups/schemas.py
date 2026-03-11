from pydantic import BaseModel
from typing import Optional
from datetime import datetime


class GroupOut(BaseModel):
    id: int
    group_name: str
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class GroupCreate(BaseModel):
    group_name: str


class GroupUpdate(BaseModel):
    id: int
    new_name: str
