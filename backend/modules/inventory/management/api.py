from __future__ import annotations
from typing import List
import logging

from fastapi import APIRouter, Depends, HTTPException

from common.deps import get_current_user, inventory_conn
from common.dto import InventoryItemOut, InventoryMetadataRecord, LiveSyncResult
from .schemas import InventoryMetadataCreateIn, InventoryMetadataUpdateIn, LiveSyncIn
from .service import InventoryManagementService

from modules.inventory.management.sales_sync import sync_sales_to_inventory_metadata

logger = logging.getLogger(__name__)
router = APIRouter()


def _svc() -> InventoryManagementService:
    return InventoryManagementService()

@router.get("/health")
def inventory_management_health():
    return {"status": "Inventory management module ready"}


# ---- Zoho Inventory Items ----
@router.get("/items")
def get_inventory_items(page: int = 1, per_page: int = 100, user=Depends(get_current_user)):
    """Get inventory items from Zoho Inventory API with pagination"""
    try:
        result = _svc().get_zoho_inventory_items(page=page, per_page=per_page)
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
    """Save inventory metadata to PostgreSQL and sync to Zoho"""
    try:
        result = _svc().save_inventory_metadata(body.model_dump())
        return {"detail": "Metadata saved and synced", "result": result}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error saving metadata: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/sync-sales-data")
async def sync_sales_data(
        dry_run: bool = False,
        current_user: dict = Depends(get_current_user)
):
    """Sync 6 months of sales data to inventory_metadata"""
    try:
        stats = sync_sales_to_inventory_metadata(dry_run=dry_run)
        return {"status": "success", "stats": stats}
    except Exception as e:
        logger.error(f"Sync failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.patch("/metadata/{item_id}")
def update_inventory_metadata(
        item_id: str,
        body: InventoryMetadataUpdateIn,
        user=Depends(get_current_user)
):
    """Update inventory metadata"""
    try:
        metadata = body.model_dump(exclude_unset=True)
        metadata['item_id'] = item_id
        result = _svc().save_inventory_metadata(metadata)
        return {"detail": "Metadata updated and synced", "result": result}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error updating metadata: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ---- Live Sync ----
@router.post("/live-sync", response_model=LiveSyncResult)
def live_inventory_sync(body: LiveSyncIn, user=Depends(get_current_user)):
    """Perform live inventory sync - adjust Zoho stock directly"""
    try:
        result = _svc().live_inventory_sync(
            body.item_id,
            body.new_quantity,
            body.reason
        )
        return LiveSyncResult(**result)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error in live sync: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ---- Legacy endpoints for compatibility ----
@router.get("/categories")
def get_categories(user=Depends(get_current_user)):
    """Get all inventory categories"""
    return _svc().get_categories()


@router.get("/suppliers")
def get_suppliers(user=Depends(get_current_user)):
    """Get all suppliers"""
    return _svc().get_suppliers()


@router.post("/sync-magento-product-list")
def sync_magento_product_list(user=Depends(get_current_user)):
    """
    Sync Zoho inventory items to magento_product_list table.
    Updates SKU, product name, item_id, and discontinued_status for all products.
    """
    try:
        result = _svc().sync_zoho_to_magento_product_list()
        return result
    except Exception as e:
        logger.error(f"Error syncing magento product list: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/parse-discontinued-status")
def parse_discontinued_status(user=Depends(get_current_user)):
    """
    Parse discontinued_status from additional_attributes field in magento_product_list.
    This should be run after importing Magento product data with additional_attributes.
    """
    try:
        result = _svc().update_discontinued_status_from_additional_attributes()
        return {
            "status": "success",
            "message": f"Updated {result['updated']} of {result['total_processed']} products",
            "stats": result
        }
    except Exception as e:
        logger.error(f"Error parsing discontinued status: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/magento-products")
def get_magento_products(
    status_filters: str = None,  # Comma-separated list: "Active,Temporarily OOS,Pre Order,Samples"
    user=Depends(get_current_user)
):
    """
    Get products from magento_product_list, optionally filtered by discontinued_status.
    If status_filters is None, returns all products.
    """
    try:
        result = _svc().get_magento_products(status_filters)
        return result
    except Exception as e:
        logger.error(f"Error fetching magento products: {e}")
        raise HTTPException(status_code=500, detail=str(e))


__all__ = ["router"]
