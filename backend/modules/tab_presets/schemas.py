from pydantic import BaseModel, Field
from typing import List, Optional
from datetime import datetime


class TabPresetOut(BaseModel):
    id: int
    preset_name: str
    allowed_tabs: List[str] = Field(default_factory=list)
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class TabPresetCreate(BaseModel):
    preset_name: str
    allowed_tabs: List[str] = Field(default_factory=list)


class TabPresetUpdate(BaseModel):
    preset_name: str  # key
    new_preset_name: Optional[str] = None
    allowed_tabs: Optional[List[str]] = None
