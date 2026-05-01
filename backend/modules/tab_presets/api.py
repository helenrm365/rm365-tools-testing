from fastapi import APIRouter, Depends, HTTPException, Query
from typing import List
from common.deps import get_current_user
from .schemas import TabPresetCreate, TabPresetUpdate, TabPresetOut
from .service import TabPresetsService

router = APIRouter()
svc = TabPresetsService()


@router.get("", response_model=List[TabPresetOut])
def list_tab_presets(user=Depends(get_current_user)):
    """Get all available tab presets."""
    try:
        return svc.list_all()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch tab presets: {str(e)}")


@router.get("/{preset_name}", response_model=TabPresetOut)
def get_tab_preset(preset_name: str, user=Depends(get_current_user)):
    """Get a specific tab preset by name."""
    try:
        preset = svc.get_by_name(preset_name)
        if not preset:
            raise HTTPException(status_code=404, detail="Tab preset not found")
        return preset
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch tab preset: {str(e)}")


@router.post("", status_code=201)
def create_tab_preset(body: TabPresetCreate, user=Depends(get_current_user)):
    """Create a new tab preset."""
    try:
        preset_id = svc.create(body.preset_name, body.allowed_tabs)
        return {"detail": "created", "id": preset_id}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create tab preset: {str(e)}")


@router.patch("")
def update_tab_preset(body: TabPresetUpdate, user=Depends(get_current_user)):
    """Update an existing tab preset (and sync allowed_tabs to all users using it)."""
    try:
        svc.update(
            body.preset_name,
            new_preset_name=body.new_preset_name,
            allowed_tabs=body.allowed_tabs,
        )
        return {"detail": "updated"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update tab preset: {str(e)}")


@router.delete("")
def delete_tab_preset(preset_name: str = Query(...), user=Depends(get_current_user)):
    """Delete a tab preset."""
    try:
        svc.delete(preset_name)
        return {"detail": "deleted"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to delete tab preset: {str(e)}")
