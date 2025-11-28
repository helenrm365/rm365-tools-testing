from pydantic import BaseModel, Field
from typing import List, Optional

class UserOut(BaseModel):
    username: str
    role: Optional[str] = None
    allowed_tabs: List[str] = Field(default_factory=list)

class UserCreate(BaseModel):
    username: str
    password: str
    role: str = 'user'
    allowed_tabs: List[str] = Field(default_factory=list)

class UserUpdate(BaseModel):
    username: str                    # key
    new_username: Optional[str] = None
    new_password: Optional[str] = None
    role: Optional[str] = None
    allowed_tabs: Optional[List[str]] = None
