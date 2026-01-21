"""API routes for employee locations management."""
from __future__ import annotations
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from common.deps import get_current_user
from .locations_repo import LocationsRepo
from .locations_schemas import LocationOut, LocationCreateIn, LocationUpdateIn

router = APIRouter()


def _repo() -> LocationsRepo:
    return LocationsRepo()


@router.get("/init")
def init_locations_table(user=Depends(get_current_user)):
    """Initialize the locations table with default values if it doesn't exist."""
    return _repo().init_table()


@router.get("", response_model=List[LocationOut])
def list_locations(user=Depends(get_current_user)):
    """Get all locations."""
    try:
        locations = _repo().list_all()
        return locations
    except Exception as e:
        print(f"[Locations API] Error listing locations: {e}")
        # Return empty list if table doesn't exist
        return []


@router.get("/country-codes", response_model=List[str])
def list_country_codes(user=Depends(get_current_user)):
    """Get all unique country codes."""
    try:
        return _repo().get_unique_country_codes()
    except Exception as e:
        print(f"[Locations API] Error listing country codes: {e}")
        return []


@router.get("/by-country/{country_code}", response_model=List[LocationOut])
def list_by_country(country_code: str, user=Depends(get_current_user)):
    """Get all locations for a specific country code."""
    try:
        return _repo().list_by_country_code(country_code)
    except Exception as e:
        print(f"[Locations API] Error listing by country: {e}")
        return []


@router.get("/by-name/{name}", response_model=Optional[LocationOut])
def get_by_name(name: str, user=Depends(get_current_user)):
    """Get a location by name."""
    location = _repo().get_by_name(name)
    return location


@router.get("/by-city-code/{city_code}", response_model=Optional[LocationOut])
def get_by_city_code(city_code: str, user=Depends(get_current_user)):
    """Get a location by city code."""
    location = _repo().get_by_city_code(city_code)
    return location


@router.get("/{location_id}", response_model=LocationOut)
def get_location(location_id: int, user=Depends(get_current_user)):
    """Get a specific location by ID."""
    location = _repo().get_by_id(location_id)
    if not location:
        raise HTTPException(status_code=404, detail="Location not found")
    return location


@router.post("", response_model=LocationOut)
def create_location(body: LocationCreateIn, user=Depends(get_current_user)):
    """Create a new location."""
    # Check if city code already exists (city codes should be unique)
    existing = _repo().get_by_city_code(body.city_code)
    if existing:
        raise HTTPException(status_code=400, detail=f"Location with city code '{body.city_code}' already exists")
    
    return _repo().create(name=body.name, city_code=body.city_code, country_code=body.country_code)


@router.patch("/{location_id}", response_model=LocationOut)
def update_location(location_id: int, body: LocationUpdateIn, user=Depends(get_current_user)):
    """Update an existing location."""
    # Check if location exists
    existing = _repo().get_by_id(location_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Location not found")
    
    # Check if new city code conflicts with existing
    if body.city_code and body.city_code.upper() != existing['city_code']:
        conflict = _repo().get_by_city_code(body.city_code)
        if conflict:
            raise HTTPException(status_code=400, detail=f"Location with city code '{body.city_code}' already exists")
    
    updated = _repo().update(location_id, name=body.name, city_code=body.city_code, country_code=body.country_code)
    if not updated:
        raise HTTPException(status_code=404, detail="Location not found")
    return updated


@router.delete("/{location_id}")
def delete_location(location_id: int, user=Depends(get_current_user)):
    """Delete a location."""
    deleted = _repo().delete(location_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Location not found")
    return {"status": "success", "message": "Location deleted"}
