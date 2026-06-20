# backend/modules/inventory/sourcing/api.py
"""
API endpoints for Product Sourcing module
Implements the "Command Center" architecture for supplier price comparison
"""
from __future__ import annotations
import logging
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response, UploadFile, File, Form
from fastapi.responses import StreamingResponse

from common.deps import get_current_user
from .schemas import (
    FXRatesResponse,
    FXRateManualIn,
    SupplierCreateIn,
    SupplierUpdateIn,
    SupplierOut,
    SupplierPricingCreateIn,
    SupplierPricingUpdateIn,
    SupplierPricingOut,
    SupplierMatrixBulkUpdateIn,
    AnalysisFilters,
    GoogleSheetSyncRequest,
    SupplierProductMappingCreateIn,
    SupplierProductMappingOut,
    PdfImportPreviewResponse,
)
from .service import SourcingService, PdfParseCancelled

logger = logging.getLogger(__name__)
router = APIRouter()


def _svc() -> SourcingService:
    return SourcingService()


# ============================================================================
# HEALTH & INITIALIZATION
# ============================================================================

@router.get("/health")
def sourcing_health():
    """Health check for sourcing module"""
    return {"status": "healthy", "message": "Sourcing module ready"}


@router.get("/status")
def check_tables_status(user=Depends(get_current_user)):
    """Check if sourcing tables exist"""
    try:
        return _svc().check_tables_status()
    except Exception as e:
        logger.error(f"Error checking tables: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/init")
def initialize_tables(user=Depends(get_current_user)):
    """Initialize sourcing tables if they don't exist"""
    try:
        _svc().ensure_tables()
        return {"status": "success", "message": "Sourcing tables initialized"}
    except Exception as e:
        logger.error(f"Error initializing tables: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================================
# FX RATES (Sheet 2: The Currency Engine)
# ============================================================================

@router.get("/fx-rates", response_model=FXRatesResponse)
def get_fx_rates(user=Depends(get_current_user)):
    """
    Get current exchange rates (GBP as base currency)
    Combines live API rates with manual overrides
    """
    try:
        return _svc().get_fx_rates()
    except Exception as e:
        logger.error(f"Error fetching FX rates: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/fx-rates/override")
def set_fx_override(
    body: FXRateManualIn,
    user=Depends(get_current_user)
):
    """
    Set a manual FX rate override
    Use this when you need to lock in a specific rate for calculations
    """
    try:
        result = _svc().set_fx_override(
            body.currency_code,
            body.rate,
            body.notes,
            user.get('username')
        )
        return {"status": "success", "override": result}
    except Exception as e:
        logger.error(f"Error setting FX override: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/fx-rates/override/{currency_code}")
def remove_fx_override(
    currency_code: str,
    user=Depends(get_current_user)
):
    """Remove FX rate override (revert to live rate)"""
    try:
        deleted = _svc().remove_fx_override(currency_code)
        if not deleted:
            raise HTTPException(status_code=404, detail="Override not found")
        return {"status": "success", "message": f"Override for {currency_code} removed"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error removing FX override: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================================
# SUPPLIERS
# ============================================================================

@router.get("/suppliers", response_model=List[SupplierOut])
def get_suppliers(
    active_only: bool = Query(True, description="Only return active suppliers"),
    user=Depends(get_current_user)
):
    """Get all suppliers"""
    try:
        suppliers = _svc().get_suppliers(active_only)
        return [SupplierOut(**s) for s in suppliers]
    except Exception as e:
        logger.error(f"Error fetching suppliers: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/suppliers/{supplier_id}", response_model=SupplierOut)
def get_supplier(
    supplier_id: int,
    user=Depends(get_current_user)
):
    """Get supplier by ID"""
    try:
        supplier = _svc().get_supplier(supplier_id)
        if not supplier:
            raise HTTPException(status_code=404, detail="Supplier not found")
        return SupplierOut(**supplier)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching supplier: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/suppliers", response_model=SupplierOut, status_code=201)
def create_supplier(
    body: SupplierCreateIn,
    user=Depends(get_current_user)
):
    """Create a new supplier"""
    try:
        supplier = _svc().create_supplier(body.model_dump())
        return SupplierOut(**supplier)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
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
        supplier = _svc().update_supplier(supplier_id, body.model_dump(exclude_unset=True))
        return SupplierOut(**supplier)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error updating supplier: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/suppliers/{supplier_id}")
def delete_supplier(
    supplier_id: int,
    user=Depends(get_current_user)
):
    """Delete a supplier and all their pricing"""
    try:
        deleted = _svc().delete_supplier(supplier_id)
        if not deleted:
            raise HTTPException(status_code=404, detail="Supplier not found")
        return {"status": "success", "message": "Supplier deleted"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting supplier: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================================
# SUPPLIER PRICING (Sheet 3: The Matrix)
# ============================================================================

@router.get("/pricing/{sku}")
def get_pricing_for_sku(
    sku: str,
    user=Depends(get_current_user)
):
    """Get all supplier pricing for a SKU"""
    try:
        pricing = _svc().get_pricing_for_sku(sku)
        return {"sku": sku, "pricing": pricing}
    except Exception as e:
        logger.error(f"Error fetching pricing: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/pricing", response_model=SupplierPricingOut, status_code=201)
def upsert_pricing(
    body: SupplierPricingCreateIn,
    user=Depends(get_current_user)
):
    """Create or update supplier pricing for a product"""
    try:
        result = _svc().upsert_pricing(body.model_dump())
        return SupplierPricingOut(**result)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error upserting pricing: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/pricing/{sku}/{supplier_id}")
def delete_pricing(
    sku: str,
    supplier_id: int,
    user=Depends(get_current_user)
):
    """Delete a pricing entry"""
    try:
        deleted = _svc().delete_pricing(sku, supplier_id)
        if not deleted:
            raise HTTPException(status_code=404, detail="Pricing entry not found")
        return {"status": "success", "message": "Pricing deleted"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting pricing: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/pricing/bulk")
def bulk_update_pricing(
    body: SupplierMatrixBulkUpdateIn,
    user=Depends(get_current_user)
):
    """Bulk update pricing from matrix view (like editing a spreadsheet)"""
    try:
        result = _svc().bulk_upsert_pricing(body.updates)
        return {"status": "success", **result}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error bulk updating pricing: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================================
# SUPPLIER MATRIX VIEW (Spreadsheet-like view)
# ============================================================================

@router.get("/matrix")
def get_supplier_matrix(
    page: int = Query(1, ge=1),
    per_page: int = Query(100, ge=1, le=100000),
    search: Optional[str] = Query(None, description="Search by SKU, product name, or brand"),
    status: Optional[str] = Query(None, description="Filter by status: Available, Unavailable, or comma-separated"),
    sort_by: Optional[str] = Query(None, description="Column to sort by: sku, product_name, magento_price, status"),
    sort_order: Optional[str] = Query("asc", description="Sort order: asc or desc"),
    user=Depends(get_current_user)
):
    """
    Get the supplier matrix view with ALL products from inventory_metadata.
    Products come from inventory_metadata (like label generator), then supplier
    pricing is overlaid. Returns a spreadsheet-like view for entering/viewing prices.
    """
    try:
        # Parse status filter
        status_filter = None
        if status:
            status_filter = [s.strip() for s in status.split(',')]
        
        matrix = _svc().get_supplier_matrix(
            search=search,
            status_filter=status_filter,
            page=page,
            per_page=per_page,
            sort_by=sort_by,
            sort_order=sort_order
        )
        return matrix
    except Exception as e:
        logger.error(f"Error fetching matrix: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================================
# ANALYSIS DASHBOARD (Sheet 4: The Brain)
# ============================================================================

@router.get("/analysis")
def get_analysis_dashboard(
    page: int = Query(1, ge=1),
    per_page: int = Query(100, ge=1, le=100000),
    search: Optional[str] = Query(None, description="Search by SKU, product name, or brand"),
    category: Optional[str] = Query(None, description="Filter by category"),
    status: Optional[str] = Query(None, description="Filter by status: Available, Unavailable, or comma-separated"),
    margin_status: Optional[str] = Query(
        None, 
        description="Filter by margin status: healthy, warning, loss, no_data, no_magento_price"
    ),
    sort_by: Optional[str] = Query(None, description="Column to sort by: sku, product_name, magento_price, best_price, margin_percentage, status"),
    sort_order: Optional[str] = Query("asc", description="Sort order: asc or desc"),
    user=Depends(get_current_user)
):
    """
    Get the analysis dashboard with ALL products from inventory_metadata.
    Products come from inventory_metadata (like label generator), with Magento
    prices using special_price > price > N/A logic. Returns best prices and margin calculations.
    """
    try:
        # Parse status filter
        status_filter = None
        if status:
            status_filter = [s.strip() for s in status.split(',')]
        
        return _svc().get_analysis_dashboard(
            search=search,
            category=category,
            margin_status=margin_status,
            status_filter=status_filter,
            page=page,
            per_page=per_page,
            sort_by=sort_by,
            sort_order=sort_order
        )
    except Exception as e:
        logger.error(f"Error fetching analysis: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================================
# IMPORT/EXPORT
# ============================================================================

@router.get("/export/csv")
def export_matrix_csv(user=Depends(get_current_user)):
    """Export supplier matrix as CSV file"""
    try:
        csv_content = _svc().export_matrix_csv()
        
        return Response(
            content=csv_content,
            media_type="text/csv",
            headers={
                "Content-Disposition": "attachment; filename=supplier_matrix.csv"
            }
        )
    except Exception as e:
        logger.error(f"Error exporting CSV: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/import/csv")
async def import_matrix_csv(
    file: UploadFile = File(...),
    user=Depends(get_current_user)
):
    """
    Import supplier matrix from CSV file
    Expected format: sku, SUPPLIER1_price, SUPPLIER1_currency, SUPPLIER1_notes, ...
    """
    try:
        contents = await file.read()
        csv_content = contents.decode('utf-8')
        result = _svc().import_matrix_csv(csv_content)
        return {"status": "success", **result}
    except Exception as e:
        logger.error(f"Error importing CSV: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/import/pdf", response_model=PdfImportPreviewResponse)
async def import_matrix_pdf(
    file: UploadFile = File(...),
    supplier_id: int = Form(...),
    user=Depends(get_current_user)
):
    """
    Parse a supplier PDF price list and return a preview of pricing changes.
    Uses product mappings to match PDF line items to internal SKUs.
    Does NOT commit changes — send confirmed items to POST /pricing/bulk to apply.
    """
    try:
        contents = await file.read()
        result = _svc().import_matrix_pdf(contents, supplier_id)
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error parsing PDF: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/import/pdf/stream")
async def import_matrix_pdf_stream(
    file: UploadFile = File(...),
    supplier_id: int = Form(...),
    user=Depends(get_current_user)
):
    """
    Streaming variant of /import/pdf. Emits Server-Sent Events with live parse
    progress for large/multi-page PDFs, then a final 'complete' event carrying
    the full preview payload. Mirrors the manual-task SSE pattern.

    If the client disconnects (user cancels/closes the modal), the worker thread
    is cooperatively cancelled at the next page boundary so it stops parsing.
    """
    import json
    import queue
    from threading import Event, Thread

    contents = await file.read()
    progress_queue: queue.Queue = queue.Queue()
    result_holder = [None]
    error_holder = [None]
    cancel_event = Event()

    def progress_callback(percent: int, message: str) -> None:
        if cancel_event.is_set():
            raise PdfParseCancelled()
        progress_queue.put({"type": "progress", "percent": percent, "message": message})

    def run_parse() -> None:
        try:
            result_holder[0] = _svc().import_matrix_pdf(
                contents, supplier_id, progress_cb=progress_callback
            )
        except PdfParseCancelled:
            pass  # client went away — nothing to report
        except ValueError as e:
            error_holder[0] = {"status": 400, "message": str(e)}
        except Exception as e:  # noqa: BLE001
            logger.error(f"Error parsing PDF (stream): {e}")
            error_holder[0] = {"status": 500, "message": str(e)}
        finally:
            progress_queue.put({"type": "done"})

    worker = Thread(target=run_parse, daemon=True)
    worker.start()

    def event_stream():
        try:
            while True:
                try:
                    event = progress_queue.get(timeout=300)
                except queue.Empty:
                    yield f"data: {json.dumps({'type': 'progress', 'percent': -1, 'message': 'Still processing…'})}\n\n"
                    continue
                if event["type"] == "done":
                    if error_holder[0] is not None:
                        yield f"data: {json.dumps({'type': 'error', **error_holder[0]})}\n\n"
                    elif result_holder[0] is not None:
                        yield f"data: {json.dumps({'type': 'progress', 'percent': 100, 'message': 'Done'})}\n\n"
                        yield f"data: {json.dumps({'type': 'complete', 'result': result_holder[0]})}\n\n"
                    break
                yield f"data: {json.dumps(event)}\n\n"
        finally:
            # Generator closed (normal finish OR client disconnect): signal the
            # worker to stop at its next page boundary.
            cancel_event.set()

    return StreamingResponse(event_stream(), media_type="text/event-stream")


# ============================================================================
# GOOGLE SHEETS
# ============================================================================

@router.post("/sync/google-sheet/export")
def sync_matrix_to_gsheet(
    request: GoogleSheetSyncRequest,
    user=Depends(get_current_user)
):
    """
    Sync FULL matrix to Google Sheet.
    Replaces the content of the first worksheet.
    """
    try:
        result = _svc().sync_matrix_to_gsheet(request.sheet_id)
        return {"status": "success", **result}
    except Exception as e:
        logger.error(f"Error syncing to Google Sheet: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/sync/google-sheet/import")
def sync_matrix_from_gsheet(
    request: GoogleSheetSyncRequest,
    user=Depends(get_current_user)
):
    """
    Sync from Google Sheet (Update Only).
    """
    try:
        result = _svc().sync_matrix_from_gsheet(request.sheet_id)
        return {"status": "success", **result}
    except Exception as e:
        logger.error(f"Error syncing from Google Sheet: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================================
# PRODUCT MAPPINGS
# ============================================================================

@router.get("/mappings", response_model=List[SupplierProductMappingOut])
def get_supplier_mappings(
    supplier_id: Optional[int] = Query(None, description="Filter mappings by supplier ID"),
    user=Depends(get_current_user)
):
    """Get all supplier product mappings"""
    try:
        mappings = _svc().get_supplier_mappings(supplier_id)
        return [SupplierProductMappingOut(**m) for m in mappings]
    except Exception as e:
        logger.error(f"Error fetching mappings: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/mappings", response_model=SupplierProductMappingOut, status_code=201)
def create_supplier_mapping(
    body: SupplierProductMappingCreateIn,
    user=Depends(get_current_user)
):
    """Create or update a supplier product mapping"""
    try:
        mapping = _svc().create_supplier_mapping(body.model_dump())
        return SupplierProductMappingOut(**mapping)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error creating mapping: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/mappings/{mapping_id}")
def delete_supplier_mapping(
    mapping_id: int,
    user=Depends(get_current_user)
):
    """Delete a supplier product mapping"""
    try:
        deleted = _svc().delete_supplier_mapping(mapping_id)
        if not deleted:
            raise HTTPException(status_code=404, detail="Mapping not found")
        return {"status": "success", "message": "Mapping deleted"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting mapping: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/mappings/import")
async def import_supplier_mappings(
    file: UploadFile = File(...),
    user=Depends(get_current_user)
):
    """
    Import product mappings from a CSV or Excel file.
    Required columns: supplier_code, supplier_identifier, internal_sku
    """
    try:
        contents = await file.read()
        result = _svc().import_mappings_file(contents, file.filename or 'upload')
        return {"status": "success", **result}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error importing mappings: {e}")
        raise HTTPException(status_code=500, detail=str(e))
