"""
API endpoints for Product Sourcing module
"""
from __future__ import annotations
from typing import List, Optional
import logging

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from fastapi.responses import JSONResponse

from common.deps import get_current_user
from common.currency import get_exchange_rates, get_rate_for_display
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

@router.get("/prices")
def get_prices(
    supplier_product_id: Optional[int] = None,
    internal_sku: Optional[str] = None,
    limit: int = 100,
    user=Depends(get_current_user)
):
    """Get price history with optional filters (alias for /prices/history for convenience)"""
    try:
        history = _svc().get_price_history(
            supplier_product_id=supplier_product_id,
            internal_sku=internal_sku,
            limit=limit
        )
        return history
    except Exception as e:
        logger.error(f"Error fetching prices: {e}")
        raise HTTPException(status_code=500, detail=str(e))


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


# ====== Pending Price Endpoints ======

@router.get("/prices/pending")
def get_pending_prices(
    supplier_product_id: Optional[int] = None,
    supplier_id: Optional[int] = None,
    user=Depends(get_current_user)
):
    """
    Get pending (future) prices that haven't become active yet.
    
    Pending prices have effective_date > today and are not cancelled.
    Use this endpoint to view scheduled price changes.
    """
    try:
        pending = _svc().get_pending_prices(
            supplier_product_id=supplier_product_id,
            supplier_id=supplier_id
        )
        return {"pending_prices": pending, "count": len(pending)}
    except Exception as e:
        logger.error(f"Error fetching pending prices: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/prices/{price_id}")
def get_price_detail(
    price_id: int,
    user=Depends(get_current_user)
):
    """
    Get a single price entry with its computed status.
    
    Computed status is one of: 'pending', 'active', 'superseded', 'cancelled'
    """
    try:
        price = _svc().get_price_with_computed_status(price_id)
        if not price:
            raise HTTPException(status_code=404, detail="Price not found")
        return price
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching price {price_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/prices/{price_id}/cancel")
def cancel_pending_price(
    price_id: int,
    user=Depends(get_current_user)
):
    """
    Cancel a pending price.
    
    Only prices with effective_date > today (pending prices) can be cancelled.
    Active or superseded prices cannot be cancelled as they are historical records.
    """
    try:
        cancelled_by = user.get('username') if isinstance(user, dict) else None
        result = _svc().cancel_pending_price(price_id, cancelled_by=cancelled_by)
        if not result:
            raise HTTPException(
                status_code=400, 
                detail="Cannot cancel this price. Only pending prices (effective_date > today) can be cancelled."
            )
        return {"status": "cancelled", "price": result}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error cancelling price {price_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/prices/{price_id}")
def update_pending_price(
    price_id: int,
    body: SupplierPriceCreateIn,
    user=Depends(get_current_user)
):
    """
    Update a pending price.
    
    Only prices with effective_date > today (pending prices) can be updated.
    Active or superseded prices cannot be modified as they are historical records.
    
    Fields that can be updated: buy_price, currency, effective_date, notes
    Note: new effective_date must also be in the future.
    """
    try:
        updated_by = user.get('username') if isinstance(user, dict) else None
        result = _svc().update_pending_price(price_id, body.model_dump(), updated_by=updated_by)
        if not result:
            raise HTTPException(
                status_code=400, 
                detail="Cannot update this price. Only pending prices (effective_date > today) can be modified."
            )
        return {"status": "updated", "price": result}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating price {price_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/prices/active/{supplier_product_id}")
def get_active_price_endpoint(
    supplier_product_id: int,
    user=Depends(get_current_user)
):
    """
    Get the currently active price for a specific supplier product.
    
    Active price is determined by:
    - effective_date <= today (not pending/future)
    - status != 'cancelled'
    - Most recent effective_date wins (with created_at as tiebreaker)
    """
    try:
        active = _svc().get_active_price(supplier_product_id)
        if not active:
            raise HTTPException(status_code=404, detail="No active price found for this supplier product")
        return active
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching active price for supplier_product {supplier_product_id}: {e}")
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


@router.get("/comparison-with-inventory")
def get_comparison_with_inventory(
    internal_sku: Optional[str] = None,
    user=Depends(get_current_user)
):
    """
    Get supplier price comparison WITH Magento inventory metadata.
    Shows Magento product details (name, stock, cost) alongside supplier prices.
    This is the recommended endpoint for full product sourcing analysis.
    """
    try:
        comparison = _svc().get_comparison_with_inventory(internal_sku=internal_sku)
        return {"products": comparison}
    except Exception as e:
        logger.error(f"Error getting comparison with inventory: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/available-skus")
def get_available_skus(
    search: Optional[str] = None,
    limit: int = 100,
    user=Depends(get_current_user)
):
    """
    Get available SKUs from inventory_metadata (Magento products).
    Use this to help map supplier products to internal SKUs.
    """
    try:
        skus = _svc().get_available_skus(search=search, limit=limit)
        return {"skus": skus, "count": len(skus)}
    except Exception as e:
        logger.error(f"Error fetching available SKUs: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/currency/rates")
def get_currency_exchange_rates(user=Depends(get_current_user)):
    """Get current exchange rates for currency conversion"""
    try:
        rates = get_exchange_rates()
        return {
            "status": "success",
            "base": "GBP",
            "rates": rates,
            "display_rates": {
                "EUR": get_rate_for_display("GBP", "EUR"),
                "USD": get_rate_for_display("GBP", "USD"),
                "GBP": 1.0
            }
        }
    except Exception as e:
        logger.error(f"Error fetching exchange rates: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ====== Import Endpoints ======

@router.post("/import/validate")
async def validate_csv_import(
    file: UploadFile = File(...),
    supplier_id: int = Form(...),
    user=Depends(get_current_user)
):
    """
    Validate CSV file and detect conflicts before importing.
    Returns a list of conflicts that need user resolution.
    
    Conflict types:
    - data_error: Invalid data (missing fields, bad format) - blocks import
    - duplicate_exact: Identical to existing record - auto-skip
    - existing_mapping: Will update existing record - requires confirmation
    - pending_change: Future price scheduled - requires resolution
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
        
        # Validate required columns exist
        required_cols = {'supplier_sku', 'buy_price', 'currency', 'internal_sku'}
        actual_cols = set(rows[0].keys())
        missing = required_cols - actual_cols
        if missing:
            raise HTTPException(
                status_code=400, 
                detail=f"Missing required columns: {', '.join(missing)}"
            )
        
        # Validate and detect conflicts
        result = _svc().validate_csv_import(rows, supplier_id)
        
        # Include the parsed rows for frontend to use in final import
        result['rows'] = rows
        result['supplier_id'] = supplier_id
        result['filename'] = file.filename
        
        return result
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error validating CSV: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/import/execute")
async def execute_csv_import(
    body: dict,
    user=Depends(get_current_user)
):
    """
    Execute CSV import with user-provided conflict resolutions.
    
    Expected body:
    {
        "rows": [...],  # Parsed CSV rows from validation
        "supplier_id": int,
        "filename": str,
        "resolutions": {  # row_index -> resolution
            "0": "update",
            "3": "skip",
            "5": "overwrite"
        }
    }
    """
    try:
        rows = body.get('rows', [])
        supplier_id = body.get('supplier_id')
        filename = body.get('filename', 'unknown.csv')
        resolutions = body.get('resolutions', {})
        
        if not rows:
            raise HTTPException(status_code=400, detail="No rows to import")
        if not supplier_id:
            raise HTTPException(status_code=400, detail="supplier_id is required")
        
        # Convert resolution keys to integers
        resolutions = {int(k): v for k, v in resolutions.items()}
        
        # Create import batch
        created_by = user.get('username') if isinstance(user, dict) else None
        batch = _svc().create_import_batch({
            'supplier_id': supplier_id,
            'import_source': 'csv',
            'filename': filename
        }, created_by=created_by)
        
        # Process import with resolutions
        result = _svc().process_csv_import_with_resolutions(
            batch_id=batch['id'],
            rows=rows,
            supplier_id=supplier_id,
            resolutions=resolutions,
            created_by=created_by
        )
        
        return result
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error executing CSV import: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/import/csv")
async def import_csv(
    file: UploadFile = File(...),
    supplier_id: int = Form(...),
    user=Depends(get_current_user)
):
    """
    Import supplier prices from CSV file.
    Required columns: supplier_sku, buy_price, currency, internal_sku
    Optional columns: product_name, effective_date
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
        required_cols = {'supplier_sku', 'buy_price', 'currency', 'internal_sku'}
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
