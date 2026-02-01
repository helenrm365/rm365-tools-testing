"""
Branch-specific Inventory Management API
Supports multiple warehouse branches: uk-birmingham, uk-london, fr-paris
Each branch has its own database table for inventory management.
"""
from __future__ import annotations
from typing import List
import logging

from fastapi import APIRouter, Depends, HTTPException

from common.deps import get_current_user
from common.dto import InventoryItemOut, InventoryMetadataRecord, LiveSyncResult
from ..schemas import InventoryMetadataCreateIn, InventoryMetadataUpdateIn
from .service import BranchInventoryService
from .repo import BranchInventoryRepo

logger = logging.getLogger(__name__)

# Branch configuration
BRANCH_CONFIG = {
    'uk-birmingham': {
        'table_name': 'uk_birmingham_inventory',
        'display_name': 'UK Birmingham'
    },
    'uk-london': {
        'table_name': 'uk_london_inventory',
        'display_name': 'UK London'
    },
    'fr-paris': {
        'table_name': 'fr_paris_inventory',
        'display_name': 'FR Paris'
    }
}

def create_branch_router(branch_id: str) -> APIRouter:
    """Create a router for a specific branch"""
    config = BRANCH_CONFIG.get(branch_id)
    if not config:
        raise ValueError(f"Unknown branch: {branch_id}")
    
    router = APIRouter()
    table_name = config['table_name']
    display_name = config['display_name']
    
    def _svc() -> BranchInventoryService:
        return BranchInventoryService(branch_id=branch_id, table_name=table_name)
    
    @router.get("/health")
    def branch_health():
        return {"status": f"{display_name} inventory management module ready", "branch": branch_id}
    
    @router.get("/status")
    def check_tables_status(user=Depends(get_current_user)):
        """Check if branch inventory management tables exist without creating them"""
        try:
            result = _svc().check_tables_status()
            return result
        except Exception as e:
            logger.error(f"Error checking tables status for {branch_id}: {e}")
            raise HTTPException(status_code=500, detail=str(e))
    
    @router.get("/init")
    def initialize_tables(user=Depends(get_current_user)):
        """Initialize branch inventory management tables if they don't exist"""
        try:
            svc = _svc()
            # Initialize tables first
            svc.repo.init_tables()
            # Then do initial sync to populate data
            svc.get_inventory_items_from_magento()
            return {"status": "success", "message": f"{display_name} tables initialized successfully", "branch": branch_id}
        except Exception as e:
            logger.error(f"Error initializing tables for {branch_id}: {e}")
            raise HTTPException(status_code=500, detail=str(e))
    
    @router.get("/items")
    def get_inventory_items(
        page: int = 1, 
        per_page: int = 100, 
        search: str = None,
        discontinued_status: str = None,
        show_orphaned: bool = False,
        user=Depends(get_current_user)
    ):
        """Get inventory items from branch inventory table joined with live Magento data"""
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
                "total_pages": result["total_pages"],
                "branch": branch_id
            }
        except Exception as e:
            logger.error(f"Error fetching inventory items for {branch_id}: {e}")
            raise HTTPException(status_code=500, detail=str(e))
    
    @router.get("/metadata", response_model=List[InventoryMetadataRecord])
    def load_inventory_metadata(user=Depends(get_current_user)):
        """Load branch inventory metadata from PostgreSQL"""
        try:
            metadata = _svc().load_inventory_metadata()
            return [InventoryMetadataRecord(**item) for item in metadata]
        except Exception as e:
            logger.error(f"Error loading metadata for {branch_id}: {e}")
            raise HTTPException(status_code=500, detail=str(e))
    
    @router.post("/metadata")
    def save_inventory_metadata(body: InventoryMetadataCreateIn, user=Depends(get_current_user)):
        """Save branch inventory metadata to PostgreSQL"""
        try:
            result = _svc().save_inventory_metadata(body.model_dump())
            return {"detail": "Metadata saved", "result": result, "branch": branch_id}
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        except Exception as e:
            logger.error(f"Error saving metadata for {branch_id}: {e}")
            raise HTTPException(status_code=500, detail=str(e))
    
    @router.patch("/metadata/{sku}")
    def update_inventory_metadata(
        sku: str,
        body: InventoryMetadataUpdateIn,
        user=Depends(get_current_user)
    ):
        """Update branch inventory metadata by SKU"""
        try:
            metadata = body.model_dump(exclude_unset=True)
            metadata['sku'] = sku
            result = _svc().save_inventory_metadata(metadata)
            return {"detail": "Metadata updated", "result": result, "branch": branch_id}
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        except Exception as e:
            logger.error(f"Error updating metadata for {branch_id}: {e}")
            raise HTTPException(status_code=500, detail=str(e))
    
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
        status_filters: str = None,
        user=Depends(get_current_user)
    ):
        """Get products from live Magento database"""
        try:
            result = _svc().get_magento_products(status_filters)
            return result
        except Exception as e:
            logger.error(f"Error fetching magento products for {branch_id}: {e}")
            raise HTTPException(status_code=500, detail=str(e))
    
    return router

# Create routers for each branch
uk_birmingham_router = create_branch_router('uk-birmingham')
uk_london_router = create_branch_router('uk-london')
fr_paris_router = create_branch_router('fr-paris')

__all__ = ['uk_birmingham_router', 'uk_london_router', 'fr_paris_router', 'BRANCH_CONFIG']
