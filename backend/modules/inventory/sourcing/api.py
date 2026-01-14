"""
API endpoints for Product Sourcing module
"""
from __future__ import annotations
from typing import List, Optional
import logging

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from fastapi.responses import JSONResponse

from common.deps import get_current_user
from .schemas import (
    SupplierCreateIn, SupplierUpdateIn, SupplierOut,
    SupplierProductCreateIn, SupplierProductUpdateIn, SupplierProductOut,
    SupplierPriceCreateIn, SupplierPriceOut,
    PriceImportCreateIn, PriceImportOut
)
from .service import SourcingService
from .repo import ensure_tables_exist

logger = logging.getLogger(__name__)
router = APIRouter()


def _svc() -> SourcingService:
    return SourcingService()


# ====== Health Check ======

@router.get("/health")
def sourcing_health():
    """Health check for product sourcing module - also ensures tables exist"""
    try:
        ensure_tables_exist()
        return {"status": "Product sourcing module ready", "tables": "initialized"}
    except Exception as e:
        logger.error(f"Health check failed: {e}")
        return {"status": "error", "detail": str(e)}


@router.post("/init-tables")
def init_tables(user=Depends(get_current_user)):
    """Explicitly initialize/verify sourcing tables"""
    try:
        from .repo import _tables_initialized
        ensure_tables_exist()
        return {
            "status": "success",
            "message": "Sourcing tables initialized",
            "tables": [
                "sourcing_suppliers",
                "sourcing_supplier_products",
                "sourcing_import_batches",
                "sourcing_prices"
            ]
        }
    except Exception as e:
        logger.error(f"Table initialization failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ====== Supplier Endpoints ======

@router.get("/suppliers", response_model=List[SupplierOut])
def get_suppliers(
    include_inactive: bool = False,
    user=Depends(get_current_user)
):
    """Get all suppliers"""
    try:
        suppliers = _svc().get_suppliers(include_inactive=include_inactive)
        return suppliers
    except Exception as e:
        logger.error(f"Error fetching suppliers: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/suppliers/{supplier_id}", response_model=SupplierOut)
def get_supplier(
    supplier_id: int,
    user=Depends(get_current_user)
):
    """Get a single supplier by ID"""
    try:
        supplier = _svc().get_supplier(supplier_id)
        if not supplier:
            raise HTTPException(status_code=404, detail="Supplier not found")
        return supplier
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching supplier {supplier_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/suppliers", response_model=SupplierOut)
def create_supplier(
    body: SupplierCreateIn,
    user=Depends(get_current_user)
):
    """Create a new supplier"""
    try:
        supplier = _svc().create_supplier(body.model_dump())
        return supplier
    except Exception as e:
        logger.error(f"Error creating supplier: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.patch("/suppliers/{supplier_id}", response_model=SupplierOut)
def update_supplier(
    supplier_id: int,
    body: SupplierUpdateIn,
    user=Depends(get_current_user)
):
    """Update an existing supplier"""
    try:
        # Filter out None values
        update_data = {k: v for k, v in body.model_dump().items() if v is not None}
        supplier = _svc().update_supplier(supplier_id, update_data)
        if not supplier:
            raise HTTPException(status_code=404, detail="Supplier not found")
        return supplier
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating supplier {supplier_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ====== Supplier Product Mapping Endpoints ======

@router.get("/products", response_model=List[SupplierProductOut])
def get_supplier_products(
    supplier_id: Optional[int] = None,
    internal_sku: Optional[str] = None,
    include_inactive: bool = False,
    user=Depends(get_current_user)
):
    """Get supplier product mappings with optional filters"""
    try:
        products = _svc().get_supplier_products(
            supplier_id=supplier_id,
            internal_sku=internal_sku,
            include_inactive=include_inactive
        )
        return products
    except Exception as e:
        logger.error(f"Error fetching supplier products: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/products", response_model=SupplierProductOut)
def create_supplier_product(
    body: SupplierProductCreateIn,
    user=Depends(get_current_user)
):
    """Create a new supplier product mapping"""
    try:
        product = _svc().create_supplier_product(body.model_dump())
        return product
    except Exception as e:
        logger.error(f"Error creating supplier product: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.patch("/products/{product_id}", response_model=SupplierProductOut)
def update_supplier_product(
    product_id: int,
    body: SupplierProductUpdateIn,
    user=Depends(get_current_user)
):
    """Update a supplier product mapping"""
    try:
        update_data = {k: v for k, v in body.model_dump().items() if v is not None}
        product = _svc().update_supplier_product(product_id, update_data)
        if not product:
            raise HTTPException(status_code=404, detail="Supplier product not found")
        return product
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating supplier product {product_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ====== Price Endpoints ======

@router.get("/prices/history")
def get_price_history(
    supplier_product_id: Optional[int] = None,
    internal_sku: Optional[str] = None,
    limit: int = 100,
    user=Depends(get_current_user)
):
    """Get price history with optional filters"""
    try:
        history = _svc().get_price_history(
            supplier_product_id=supplier_product_id,
            internal_sku=internal_sku,
            limit=limit
        )
        return {"prices": history}
    except Exception as e:
        logger.error(f"Error fetching price history: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/prices", response_model=SupplierPriceOut)
def create_price(
    body: SupplierPriceCreateIn,
    user=Depends(get_current_user)
):
    """Create a new price entry (manual price entry)"""
    try:
        # Get username from user object
        created_by = user.get('username') if isinstance(user, dict) else None
        price = _svc().create_price(body.model_dump(), created_by=created_by)
        return price
    except Exception as e:
        logger.error(f"Error creating price: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ====== Comparison Endpoints ======

@router.get("/comparison")
def get_supplier_comparison(
    internal_sku: Optional[str] = None,
    user=Depends(get_current_user)
):
    """
    Get supplier price comparison for internal products.
    Shows all suppliers' current prices side by side with cheapest highlighted.
    """
    try:
        comparison = _svc().get_supplier_comparison(internal_sku=internal_sku)
        return {"products": comparison}
    except Exception as e:
        logger.error(f"Error getting supplier comparison: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ====== Import Endpoints ======

@router.post("/import/csv")
async def import_csv(
    file: UploadFile = File(...),
    supplier_id: int = Form(...),
    user=Depends(get_current_user)
):
    """
    Import supplier prices from CSV file.
    Expected columns: supplier_sku, product_name, buy_price, effective_date (optional), currency (optional)
    """
    try:
        import csv
        import io
        
        # Validate file type
        if not file.filename.endswith('.csv'):
            raise HTTPException(status_code=400, detail="File must be a CSV")
        
        # Read file content
        content = await file.read()
        content_str = content.decode('utf-8-sig')  # Handle BOM
        
        # Parse CSV
        reader = csv.DictReader(io.StringIO(content_str))
        rows = list(reader)
        
        if not rows:
            raise HTTPException(status_code=400, detail="CSV file is empty")
        
        # Validate required columns
        required_cols = {'supplier_sku', 'buy_price'}
        actual_cols = set(rows[0].keys())
        missing = required_cols - actual_cols
        if missing:
            raise HTTPException(
                status_code=400, 
                detail=f"Missing required columns: {', '.join(missing)}"
            )
        
        # Create import batch
        created_by = user.get('username') if isinstance(user, dict) else None
        batch = _svc().create_import_batch({
            'supplier_id': supplier_id,
            'import_source': 'csv',
            'filename': file.filename
        }, created_by=created_by)
        
        # Process import
        result = _svc().process_csv_import(
            batch_id=batch['id'],
            rows=rows,
            supplier_id=supplier_id,
            created_by=created_by
        )
        
        return result
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error importing CSV: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/import/manual")
def import_manual(
    body: PriceImportCreateIn,
    user=Depends(get_current_user)
):
    """Create a manual import batch for tracking"""
    try:
        created_by = user.get('username') if isinstance(user, dict) else None
        batch = _svc().create_import_batch(
            {**body.model_dump(), 'import_source': 'manual'},
            created_by=created_by
        )
        return batch
    except Exception as e:
        logger.error(f"Error creating manual import batch: {e}")
        raise HTTPException(status_code=500, detail=str(e))
