from pydantic import BaseModel, Field
from typing import List, Optional

class UserOut(BaseModel):
    username: str
    role: Optional[str] = None
    allowed_tabs: List[str] = Field(default_factory=list)
    location_id: Optional[int] = None
    group_id: Optional[int] = None

class UserCreate(BaseModel):
    username: str
    password: str
    role: Optional[str] = None
    allowed_tabs: List[str] = Field(default_factory=list)
    location_id: Optional[int] = None
    group_id: Optional[int] = None

class UserUpdate(BaseModel):
    username: str                    # key
    new_username: Optional[str] = None
    new_password: Optional[str] = None
    role: Optional[str] = None
    allowed_tabs: Optional[List[str]] = None
    location_id: Optional[int] = None
    group_id: Optional[int] = None

class UserPreferences(BaseModel):
    dark_mode: bool = False
    accent_enabled: bool = False
    accent_color: str = "#8bc34a"
    accent_dark: str = "#7ab82d"
    accent_light: str = "#a5d461"

