from __future__ import annotations
from typing import List
import logging

from fastapi import APIRouter, Depends, HTTPException

from common.deps import get_current_user, inventory_conn
from common.dto import InventoryItemOut, InventoryMetadataRecord, LiveSyncResult
from .schemas import InventoryMetadataCreateIn, InventoryMetadataUpdateIn, LiveSyncIn
from .service import InventoryManagementService

from modules.inventory.management.magento_sync import sync_magento_to_inventory_metadata

logger = logging.getLogger(__name__)
router = APIRouter()


def _svc() -> InventoryManagementService:
    return InventoryManagementService()

@router.get("/health")
def inventory_management_health():
    return {"status": "Inventory management module ready"}


@router.get("/status")
def check_tables_status(user=Depends(get_current_user)):
    """Check if inventory management tables exist without creating them"""
    try:
        result = _svc().check_tables_status()
        return result
    except Exception as e:
        logger.error(f"Error checking tables status: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/init")
def initialize_tables(user=Depends(get_current_user)):
    """Initialize inventory management tables if they don't exist"""
    try:
        svc = _svc()
        # Initialize tables first
        svc.repo.init_tables()
        # Then do initial sync to populate data
        svc.get_inventory_items_from_magento()
        return {"status": "success", "message": "Tables initialized successfully"}
    except Exception as e:
        logger.error(f"Error initializing tables: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ---- Inventory Items ----
@router.get("/items")
def get_inventory_items(
    page: int = 1, 
    per_page: int = 100, 
    search: str = None,
    discontinued_status: str = None,
    show_orphaned: bool = False,
    user=Depends(get_current_user)
):
    """Get inventory items from inventory_metadata joined with live Magento data"""
    try:
        result = _svc().get_inventory_items(
            page=page, 
            per_page=per_page, 
            search=search,
            discontinued_status=discontinued_status,
            show_orphaned=show_orphaned
        )
        return {
            "items": [InventoryItemOut(**item) for item in result["items"]],
            "total": result["total"],
            "page": result["page"],
            "per_page": result["per_page"],
            "total_pages": result["total_pages"]
        }
    except Exception as e:
        logger.error(f"Error fetching inventory items: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ---- Metadata Management ----
@router.get("/metadata", response_model=List[InventoryMetadataRecord])
def load_inventory_metadata(user=Depends(get_current_user)):
    """Load inventory metadata from PostgreSQL"""
    try:
        metadata = _svc().load_inventory_metadata()
        return [InventoryMetadataRecord(**item) for item in metadata]
    except Exception as e:
        logger.error(f"Error loading metadata: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/metadata")
def save_inventory_metadata(body: InventoryMetadataCreateIn, user=Depends(get_current_user)):
    """Save inventory metadata to PostgreSQL"""
    try:
        result = _svc().save_inventory_metadata(body.model_dump())
        return {"detail": "Metadata saved", "result": result}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error saving metadata: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/sync-magento-data")
async def sync_magento_data(
        dry_run: bool = False,
        current_user: dict = Depends(get_current_user)
):
    """Sync 6 months of magento data to inventory_metadata"""
    try:
        stats = sync_magento_to_inventory_metadata(dry_run=dry_run)
        return {"status": "success", "stats": stats}
    except Exception as e:
        logger.error(f"Sync failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.patch("/metadata/{sku}")
def update_inventory_metadata(
        sku: str,
        body: InventoryMetadataUpdateIn,
        user=Depends(get_current_user)
):
    """Update inventory metadata by SKU"""
    try:
        metadata = body.model_dump(exclude_unset=True)
        metadata['sku'] = sku
        result = _svc().save_inventory_metadata(metadata)
        return {"detail": "Metadata updated", "result": result}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error updating metadata: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ---- Live Sync (DEPRECATED) ----
@router.post("/live-sync", response_model=LiveSyncResult, deprecated=True)
def live_inventory_sync(body: LiveSyncIn, user=Depends(get_current_user)):
    """
    DEPRECATED: Live inventory sync is no longer supported.
    Inventory is now managed via inventory_metadata table.
    """
    raise HTTPException(
        status_code=501, 
        detail="Live sync is no longer supported. Inventory is managed via inventory_metadata."
    )


# ---- Legacy endpoints for compatibility ----
@router.get("/categories")
def get_categories(user=Depends(get_current_user)):
    """Get all inventory categories"""
    return _svc().get_categories()


@router.get("/suppliers")
def get_suppliers(user=Depends(get_current_user)):
    """Get all suppliers"""
    return _svc().get_suppliers()


@router.get("/magento-products")
def get_magento_products(
    status_filters: str = None,  # Comma-separated list: "Active,Temporarily OOS,Pre Order,Samples"
    user=Depends(get_current_user)
):
    """
    Get products from live Magento database, optionally filtered by discontinued_status.
    If status_filters is None, returns all products.
    """
    try:
        result = _svc().get_magento_products(status_filters)
        return result
    except Exception as e:
        logger.error(f"Error fetching magento products: {e}")
        raise HTTPException(status_code=500, detail=str(e))


__all__ = ["router"]
