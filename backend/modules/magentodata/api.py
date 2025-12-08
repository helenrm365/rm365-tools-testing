from fastapi import APIRouter, Depends, UploadFile, File, Query
from typing import Dict, Any, Optional
import logging
from common.deps import get_current_user
from .service import MagentoDataService
from .schemas import InitTablesResponse, MagentoDataResponse, MagentoDataImportResponse, ImportHistoryResponse, MagentoSyncRequest, MagentoSyncResponse

logger = logging.getLogger(__name__)
router = APIRouter()
svc = MagentoDataService()


@router.get("/init", response_model=InitTablesResponse)
def initialize_tables(user=Depends(get_current_user)):
    """
    Initialize magento data tables (uk_magento_data, fr_magento_data, nl_magento_data).
    This endpoint is called when the magento data home page is accessed.
    """
    result = svc.initialize_tables()
    return InitTablesResponse(**result)


@router.get("/status")
def check_tables_status(user=Depends(get_current_user)):
    """
    Check which magento data tables exist in the database.
    """
    return svc.check_tables_status()


@router.get("/test", response_model=MagentoDataResponse)
def get_test_magento_data(
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    search: str = Query(""),
    user=Depends(get_current_user)
):
    """Get test magento data with pagination and search"""
    result = svc.get_region_data("test", limit, offset, search, None)
    return MagentoDataResponse(**result)


@router.post("/test-sync", response_model=MagentoSyncResponse)
async def test_sync_magento_data(user=Depends(get_current_user)):
    """
    Test sync: Fetches 10 orders from Magento and syncs to test_magento_data table.
    This is for testing the Magento integration without affecting production data.
    """
    username = user.get("username") or user.get("email") or "unknown"
    
    # Progress tracking
    progress_info = {"message": "Starting test sync..."}
    
    def progress_callback(msg: str):
        progress_info["message"] = msg
        logger.info(f"[Test Sync Progress] {msg}")
    
    result = svc.test_sync_magento_data(max_orders=10, username=username, progress_callback=progress_callback)
    result["progress"] = progress_info["message"]
    result["is_complete"] = True
    return MagentoSyncResponse(**result)


# UK Magento endpoints
@router.get("/uk", response_model=MagentoDataResponse)
def get_uk_magento_data(
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    search: str = Query(""),
    fields: str = Query(None, description="Comma-separated list of fields to return (e.g., 'sku,name,qty,original_price,special_price')"),
    user=Depends(get_current_user)
):
    """Get UK magento data with pagination, search, and optional field selection"""
    field_list = fields.split(',') if fields else None
    result = svc.get_region_data("uk", limit, offset, search, field_list)
    return MagentoDataResponse(**result)


@router.post("/uk/sync", response_model=MagentoSyncResponse)
async def sync_uk_magento_data(
    request: MagentoSyncRequest = None,
    user=Depends(get_current_user)
):
    """
    Sync live Magento data for UK region.
    Fetches orders from Magento API and breaks them down into product-level rows.
    Supports progress tracking for large syncs.
    """
    username = user.get("username") or user.get("email") or "unknown"
    
    # Extract parameters from request body if provided
    start_date = request.start_date if request else None
    end_date = request.end_date if request else None
    max_orders = request.max_orders if request else None
    resync_days = request.resync_days if request and request.resync_days is not None else 7
    
    # Progress tracking (simple in-memory for now)
    progress_info = {"message": "Starting sync..."}
    
    def progress_callback(msg: str):
        progress_info["message"] = msg
        logger.info(f"[UK Sync Progress] {msg}")
    
    result = svc.sync_magento_data("uk", start_date, end_date, max_orders, resync_days, username, progress_callback)
    result["progress"] = progress_info["message"]
    result["is_complete"] = True
    return MagentoSyncResponse(**result)


@router.post("/uk/upload", response_model=MagentoDataImportResponse)
async def upload_uk_magento_csv(
    file: UploadFile = File(...),
    user=Depends(get_current_user)
):
    """
    Upload CSV file for UK magento data.
    NOTE: This endpoint is deprecated. Use /uk/sync for live Magento data.
    """
    content = await file.read()
    csv_content = content.decode('utf-8')
    username = user.get("username") or user.get("email") or "unknown"
    result = svc.import_csv("uk", csv_content, file.filename, username)
    return MagentoDataImportResponse(**result)


# FR Magento endpoints
@router.get("/fr", response_model=MagentoDataResponse)
def get_fr_magento_data(
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    search: str = Query(""),
    fields: str = Query(None, description="Comma-separated list of fields to return"),
    user=Depends(get_current_user)
):
    """Get FR magento data with pagination, search, and optional field selection"""
    field_list = fields.split(',') if fields else None
    result = svc.get_region_data("fr", limit, offset, search, field_list)
    return MagentoDataResponse(**result)


@router.post("/fr/sync", response_model=MagentoSyncResponse)
async def sync_fr_magento_data(
    request: MagentoSyncRequest = None,
    user=Depends(get_current_user)
):
    """
    Sync live Magento data for FR region.
    NOTE: Currently uses UK Magento connection until FR credentials are configured.
    """
    username = user.get("username") or user.get("email") or "unknown"
    
    start_date = request.start_date if request else None
    end_date = request.end_date if request else None
    max_orders = request.max_orders if request else None
    resync_days = request.resync_days if request and request.resync_days is not None else 7
    
    progress_info = {"message": "Starting sync..."}
    
    def progress_callback(msg: str):
        progress_info["message"] = msg
        logger.info(f"[FR Sync Progress] {msg}")
    
    result = svc.sync_magento_data("fr", start_date, end_date, max_orders, resync_days, username, progress_callback)
    result["progress"] = progress_info["message"]
    result["is_complete"] = True
    return MagentoSyncResponse(**result)


@router.post("/fr/upload", response_model=MagentoDataImportResponse)
async def upload_fr_magento_csv(
    file: UploadFile = File(...),
    user=Depends(get_current_user)
):
    """
    Upload CSV file for FR magento data.
    NOTE: This endpoint is deprecated. Use /fr/sync for live Magento data.
    """
    content = await file.read()
    csv_content = content.decode('utf-8')
    username = user.get("username") or user.get("email") or "unknown"
    result = svc.import_csv("fr", csv_content, file.filename, username)
    return MagentoDataImportResponse(**result)


# NL Magento endpoints
@router.get("/nl", response_model=MagentoDataResponse)
def get_nl_magento_data(
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    search: str = Query(""),
    fields: str = Query(None, description="Comma-separated list of fields to return"),
    user=Depends(get_current_user)
):
    """Get NL magento data with pagination, search, and optional field selection"""
    field_list = fields.split(',') if fields else None
    result = svc.get_region_data("nl", limit, offset, search, field_list)
    return MagentoDataResponse(**result)


@router.post("/nl/sync", response_model=MagentoSyncResponse)
async def sync_nl_magento_data(
    request: MagentoSyncRequest = None,
    user=Depends(get_current_user)
):
    """
    Sync live Magento data for NL region.
    NOTE: Currently uses UK Magento connection until NL credentials are configured.
    """
    username = user.get("username") or user.get("email") or "unknown"
    
    start_date = request.start_date if request else None
    end_date = request.end_date if request else None
    max_orders = request.max_orders if request else None
    resync_days = request.resync_days if request and request.resync_days is not None else 7
    
    progress_info = {"message": "Starting sync..."}
    
    def progress_callback(msg: str):
        progress_info["message"] = msg
        logger.info(f"[NL Sync Progress] {msg}")
    
    result = svc.sync_magento_data("nl", start_date, end_date, max_orders, resync_days, username, progress_callback)
    result["progress"] = progress_info["message"]
    result["is_complete"] = True
    return MagentoSyncResponse(**result)


@router.post("/nl/upload", response_model=MagentoDataImportResponse)
async def upload_nl_magento_csv(
    file: UploadFile = File(...),
    user=Depends(get_current_user)
):
    """Upload CSV file for NL magento data"""
    content = await file.read()
    csv_content = content.decode('utf-8')
    username = user.get("username") or user.get("email") or "unknown"
    result = svc.import_csv("nl", csv_content, file.filename, username)
    return MagentoDataImportResponse(**result)


# Condensed data endpoints (6-month aggregated by SKU)
@router.get("/uk/condensed", response_model=MagentoDataResponse)
def get_uk_condensed_data(
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    search: str = Query(""),
    user=Depends(get_current_user)
):
    """Get UK condensed magento data (6-month aggregated by SKU)"""
    result = svc.get_condensed_data("uk", limit, offset, search)
    return MagentoDataResponse(**result)


@router.get("/fr/condensed", response_model=MagentoDataResponse)
def get_fr_condensed_data(
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    search: str = Query(""),
    user=Depends(get_current_user)
):
    """Get FR condensed magento data (6-month aggregated by SKU)"""
    result = svc.get_condensed_data("fr", limit, offset, search)
    return MagentoDataResponse(**result)


@router.get("/nl/condensed", response_model=MagentoDataResponse)
def get_nl_condensed_data(
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    search: str = Query(""),
    user=Depends(get_current_user)
):
    """Get NL condensed magento data (6-month aggregated by SKU)"""
    result = svc.get_condensed_data("nl", limit, offset, search)
    return MagentoDataResponse(**result)


# Import History endpoint
@router.get("/history", response_model=ImportHistoryResponse)
def get_import_history(
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    region: str = Query(None, description="Filter by region (uk, fr, nl)"),
    user=Depends(get_current_user)
):
    """Get import history with pagination and optional region filter"""
    result = svc.get_import_history(limit, offset, region)
    return ImportHistoryResponse(**result)


# SKU Aliases management endpoints
@router.get("/sku-aliases")
def get_sku_aliases(user=Depends(get_current_user)):
    """Get all SKU aliases mappings"""
    return svc.get_sku_aliases()


@router.post("/sku-aliases")
def add_sku_alias(
    alias_sku: str = Query(..., description="The alias SKU"),
    unified_sku: str = Query(..., description="The unified SKU to map to"),
    user=Depends(get_current_user)
):
    """Add a new SKU alias mapping. After adding, condensed data will be automatically refreshed."""
    return svc.add_sku_alias(alias_sku, unified_sku)


@router.delete("/sku-aliases/{alias_id}")
def delete_sku_alias(
    alias_id: int,
    user=Depends(get_current_user)
):
    """Delete a SKU alias mapping. After deletion, condensed data will be automatically refreshed."""
    return svc.delete_sku_alias(alias_id)


@router.post("/sku-aliases/auto-create-md-variants")
def auto_create_md_variant_aliases(user=Depends(get_current_user)):
    """Automatically create SKU aliases for MD variants to merge with their base SKUs. 
    This will make PROD123-MD magento data merge with PROD123 magento data."""
    return svc.auto_create_md_variant_aliases()


# Condensed data refresh endpoints
@router.post("/refresh-condensed")
def refresh_all_condensed_data(user=Depends(get_current_user)):
    """Manually refresh condensed data for all regions (UK, FR, NL)"""
    return svc.refresh_all_condensed_data()


@router.post("/refresh-condensed/{region}")
def refresh_condensed_data_for_region(
    region: str,
    user=Depends(get_current_user)
):
    """Manually refresh condensed data for a specific region"""
    return svc.refresh_condensed_data_for_region(region)


@router.get("/{region}/condensed/custom-range")
def get_custom_range_condensed_data(
    region: str,
    range_type: str = Query(..., description="Type of range: 'days', 'months', or 'since'"),
    range_value: str = Query(..., description="Value for the range (number for days/months, date string for since)"),
    use_exclusions: bool = Query(True, description="Apply customer and group exclusions"),
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    search: str = Query(""),
    user=Depends(get_current_user)
):
    """Get condensed magento data with custom date range"""
    result = svc.get_condensed_data_custom_range(
        region, range_type, range_value, use_exclusions, limit, offset, search
    )
    return MagentoDataResponse(**result)


@router.post("/create-md-aliases")
def create_md_aliases(user=Depends(get_current_user)):
    """Manually trigger MD variant alias creation"""
    return svc.create_md_variant_aliases()


# ===== CONDENSED MAGENTO FILTER ENDPOINTS =====

@router.get("/filters/customers/search/{region}")
def search_customers(
    region: str,
    q: str,
    user=Depends(get_current_user)
):
    """Search for customers by email or name"""
    return svc.search_customers(region, q)


@router.get("/filters/customers/{region}")
def get_excluded_customers(
    region: str,
    user=Depends(get_current_user)
):
    """Get list of excluded customers for a region"""
    return svc.get_excluded_customers(region)


@router.post("/filters/customers/{region}")
def add_excluded_customer(
    region: str,
    email: str,
    full_name: str = "",
    user=Depends(get_current_user)
):
    """Add a customer to the exclusion list"""
    return svc.add_excluded_customer(region, email, full_name, user.get("username", "unknown"))


@router.delete("/filters/customers/{customer_id}")
def remove_excluded_customer(
    customer_id: int,
    user=Depends(get_current_user)
):
    """Remove a customer from the exclusion list"""
    return svc.remove_excluded_customer(customer_id)


@router.get("/filters/threshold/{region}")
def get_grand_total_threshold(
    region: str,
    user=Depends(get_current_user)
):
    """Get the grand total threshold for a region"""
    return svc.get_grand_total_threshold(region)


@router.post("/filters/threshold/{region}")
def set_grand_total_threshold(
    region: str,
    threshold: float = None,
    user=Depends(get_current_user)
):
    """Set the grand total threshold for a region (requires admin/manager). Pass None to clear."""
    # Check if user has permission (admin or manager)
    user_role = user.get("role", "").lower()
    if user_role not in ["admin", "manager"]:
        return {
            "status": "error",
            "message": "Only admins and managers can set the grand total threshold"
        }
    
    return svc.set_grand_total_threshold(region, threshold, user.get("username", "unknown"))


@router.get("/filters/qty-threshold/{region}")
def get_qty_threshold(
    region: str,
    user=Depends(get_current_user)
):
    """Get the quantity threshold for a region"""
    return svc.get_qty_threshold(region)


@router.post("/filters/qty-threshold/{region}")
def set_qty_threshold(
    region: str,
    qty_threshold: int = None,
    user=Depends(get_current_user)
):
    """Set the quantity threshold for a region (requires admin/manager). Pass None to clear."""
    # Check if user has permission (admin or manager)
    user_role = user.get("role", "").lower()
    if user_role not in ["admin", "manager"]:
        return {
            "status": "error",
            "message": "Only admins and managers can set the quantity threshold"
        }
    
    return svc.set_qty_threshold(region, qty_threshold, user.get("username", "unknown"))


@router.get("/filters/customer-groups/{region}")
def get_customer_groups(
    region: str,
    user=Depends(get_current_user)
):
    """Get all customer groups for a region"""
    return svc.get_customer_groups(region)


@router.get("/filters/excluded-customer-groups/{region}")
def get_excluded_customer_groups(
    region: str,
    user=Depends(get_current_user)
):
    """Get list of excluded customer groups for a region"""
    return svc.get_excluded_customer_groups(region)


@router.post("/filters/customer-groups/{region}")
def add_excluded_customer_group(
    region: str,
    customer_group: str,
    user=Depends(get_current_user)
):
    """Add a customer group to the exclusion list"""
    return svc.add_excluded_customer_group(region, customer_group, user.get("username", "unknown"))


@router.delete("/filters/customer-groups/{group_id}")
def remove_excluded_customer_group(
    group_id: int,
    user=Depends(get_current_user)
):
    """Remove a customer group from the exclusion list"""
    return svc.remove_excluded_customer_group(group_id)


@router.get("/currency/rates")
def get_exchange_rates(user=Depends(get_current_user)):
    """Get current exchange rates for currency conversion"""
    from common.currency import get_exchange_rates, get_rate_for_display
    
    rates = get_exchange_rates()
    
    return {
        "status": "success",
        "base_currency": "GBP",
        "rates": rates,
        "conversions": {
            "GBP_to_USD": get_rate_for_display("GBP", "USD"),
            "GBP_to_EUR": get_rate_for_display("GBP", "EUR"),
            "EUR_to_USD": get_rate_for_display("EUR", "USD"),
            "USD_to_GBP": get_rate_for_display("USD", "GBP"),
            "USD_to_EUR": get_rate_for_display("USD", "EUR"),
        }
    }


@router.get("/sync-metadata")
def get_sync_metadata():
    """Get sync metadata for all regions (UK, FR, NL) - Public endpoint, no auth required"""
    return svc.get_all_sync_metadata()
