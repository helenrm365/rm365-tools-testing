"""Pydantic schemas for locations API."""
from pydantic import BaseModel, Field
from typing import Optional


class LocationOut(BaseModel):
    """Location response model."""
    id: int
    name: str
    city_code: str
    country_code: str
    created_at: Optional[str] = None


class LocationCreateIn(BaseModel):
    """Create location request model."""
    name: str = Field(..., min_length=1, max_length=255, description="Location name (e.g., 'Birmingham')")
    city_code: str = Field(..., min_length=2, max_length=10, description="City code (e.g., 'BHX')")
    country_code: str = Field(..., min_length=2, max_length=10, description="Country code (e.g., 'UK')")


class LocationUpdateIn(BaseModel):
    """Update location request model."""
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    city_code: Optional[str] = Field(None, min_length=2, max_length=10)
    country_code: Optional[str] = Field(None, min_length=2, max_length=10)
