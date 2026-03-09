from fastapi import APIRouter, Depends, UploadFile, File, Query
from typing import Dict, Any, Optional, List
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
    Initialize magento data tables (uk_magento_data, fr_magento_orders_cache, nl_magento_orders_cache).
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


@router.get("/sync-status")
def get_sync_status(user=Depends(get_current_user)):
    """
    Get Magento sync status for dashboard.
    Returns status of last sync operations.
    """
    try:
        # Check if tables exist and get last sync info
        tables_status = svc.check_tables_status()
        
        if not tables_status.get("all_tables_exist", False):
            return {
                "status": "not_initialized",
                "message": "Magento data tables not initialized"
            }
        
        # Get last import history
        history = svc.get_import_history(limit=1)
        if history.get("imports"):
            last_sync = history["imports"][0]
            return {
                "status": "ok",
                "last_sync": last_sync.get("imported_at"),
                "region": last_sync.get("region"),
                "records": last_sync.get("record_count", 0)
            }
        
        return {
            "status": "ok",
            "message": "No sync history available"
        }
    except Exception as e:
        logger.warning(f"Failed to get sync status: {e}")
        return {
            "status": "unknown",
            "message": str(e)
        }


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
def sync_test_magento_data(
    user=Depends(get_current_user)
):
    """
    Test sync: Sync the latest 10 orders to test_magento_data table.
    """
    result = svc.test_sync_magento_data(
        max_orders=10,
        username=user.get("username", "unknown")
    )
    return MagentoSyncResponse(**result)


# ===== ALL REGIONS (combined) ENDPOINTS =====

@router.get("/all")
def get_all_regions_data(
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    search: str = Query(""),
    sort_by: str = Query(None, description="Column to sort by"),
    sort_order: str = Query("desc", description="Sort order: 'asc' or 'desc'"),
    user=Depends(get_current_user)
):
    """Get combined magento data from all regions (UK, FR, NL) with a region column"""
    result = svc.get_all_regions_data(limit, offset, search, sort_by, sort_order)
    return result


@router.get("/all/aggregated")
def get_all_regions_aggregated_data(
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    search: str = Query(""),
    sort_by: str = Query("", description="Column to sort by"),
    sort_order: str = Query("desc", description="Sort order: asc or desc"),
    user=Depends(get_current_user)
):
    """Get aggregated 6-month data for all regions: UK 6M, FR 6M (FR+NL), and Total 6M"""
    result = svc.get_all_regions_aggregated_data(limit, offset, search, sort_by, sort_order)
    return result


@router.get("/all/aggregated/custom-range")
def get_all_regions_custom_range_data(
    range_type: str = Query(..., description="Type of range: 'days', 'months', or 'since'"),
    range_value: str = Query(..., description="Value for the range"),
    use_exclusions: bool = Query(True, description="Apply customer and group exclusions"),
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    search: str = Query(""),
    user=Depends(get_current_user)
):
    """Get custom range aggregated data for all regions: UK, FR (FR+NL), and Total"""
    result = svc.get_all_regions_custom_range_data(
        range_type, range_value, use_exclusions, limit, offset, search
    )
    return result


@router.get("/all/aggregated/merged")
def get_all_regions_aggregated_merged(
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    search: str = Query(""),
    sort_by: str = Query("", description="Column to sort by"),
    sort_order: str = Query("desc", description="Sort order: asc or desc"),
    user=Depends(get_current_user)
):
    """Get 6-month aggregated data as single merged table: SKU, Name, UK Qty, FR Qty, Total Qty"""
    return svc.get_all_regions_aggregated_merged(limit, offset, search, sort_by, sort_order)


@router.get("/all/aggregated/custom-range/merged")
def get_all_regions_custom_range_merged(
    range_type: str = Query(..., description="Type of range: 'days', 'months', or 'since'"),
    range_value: str = Query(..., description="Value for the range"),
    use_exclusions: bool = Query(True, description="Apply customer and group exclusions"),
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    search: str = Query(""),
    sort_by: str = Query("", description="Column to sort by"),
    sort_order: str = Query("desc", description="Sort order: asc or desc"),
    user=Depends(get_current_user)
):
    """Get custom range aggregated data as single merged table"""
    return svc.get_all_regions_custom_range_merged(
        range_type, range_value, use_exclusions, limit, offset, search, sort_by, sort_order
    )


# UK Magento endpoints
@router.get("/uk", response_model=MagentoDataResponse)
def get_uk_magento_data(
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    search: str = Query(""),
    fields: str = Query(None, description="Comma-separated list of fields to return (e.g., 'sku,name,qty,original_price,special_price')"),
    sort_by: str = Query(None, description="Column to sort by (e.g., 'sku', 'name', 'qty', 'imported_at')"),
    sort_order: str = Query("desc", description="Sort order: 'asc' or 'desc'"),
    user=Depends(get_current_user)
):
    """Get UK magento data with pagination, search, and optional field selection"""
    field_list = fields.split(',') if fields else None
    result = svc.get_region_data("uk", limit, offset, search, field_list, sort_by, sort_order)
    return MagentoDataResponse(**result)


@router.post("/uk/sync", response_model=MagentoSyncResponse)
def sync_uk_magento_data(
    request: MagentoSyncRequest,
    user=Depends(get_current_user)
):
    """
    Sync UK magento data from live Magento DB.
    """
    result = svc.sync_magento_data(
        region="uk",
        start_date=request.start_date,
        end_date=request.end_date,
        max_orders=request.max_orders,
        resync_days=request.resync_days,
        username=user.get("username", "unknown")
    )
    return MagentoSyncResponse(**result)





# FR Magento endpoints
@router.get("/fr", response_model=MagentoDataResponse)
def get_fr_magento_orders_cache(
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    search: str = Query(""),
    fields: str = Query(None, description="Comma-separated list of fields to return"),
    sort_by: str = Query(None, description="Column to sort by (e.g., 'sku', 'name', 'qty', 'imported_at')"),
    sort_order: str = Query("desc", description="Sort order: 'asc' or 'desc'"),
    user=Depends(get_current_user)
):
    """Get FR magento data with pagination, search, and optional field selection"""
    field_list = fields.split(',') if fields else None
    result = svc.get_region_data("fr", limit, offset, search, field_list, sort_by, sort_order)
    return MagentoDataResponse(**result)


@router.post("/fr/sync", response_model=MagentoSyncResponse)
def sync_fr_magento_orders_cache(
    request: MagentoSyncRequest,
    user=Depends(get_current_user)
):
    """
    Sync FR magento data from live Magento DB.
    """
    result = svc.sync_magento_data(
        region="fr",
        start_date=request.start_date,
        end_date=request.end_date,
        max_orders=request.max_orders,
        resync_days=request.resync_days,
        username=user.get("username", "unknown")
    )
    return MagentoSyncResponse(**result)





# NL Magento endpoints
@router.get("/nl", response_model=MagentoDataResponse)
def get_nl_magento_orders_cache(
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    search: str = Query(""),
    fields: str = Query(None, description="Comma-separated list of fields to return"),
    sort_by: str = Query(None, description="Column to sort by (e.g., 'sku', 'name', 'qty', 'imported_at')"),
    sort_order: str = Query("desc", description="Sort order: 'asc' or 'desc'"),
    user=Depends(get_current_user)
):
    """Get NL magento data with pagination, search, and optional field selection"""
    field_list = fields.split(',') if fields else None
    result = svc.get_region_data("nl", limit, offset, search, field_list, sort_by, sort_order)
    return MagentoDataResponse(**result)


@router.post("/nl/sync", response_model=MagentoSyncResponse)
def sync_nl_magento_orders_cache(
    request: MagentoSyncRequest,
    user=Depends(get_current_user)
):
    """
    Sync NL magento data from live Magento DB.
    """
    result = svc.sync_magento_data(
        region="nl",
        start_date=request.start_date,
        end_date=request.end_date,
        max_orders=request.max_orders,
        resync_days=request.resync_days,
        username=user.get("username", "unknown")
    )
    return MagentoSyncResponse(**result)





# Aggregated data endpoints (6-month aggregated by SKU)
@router.get("/uk/aggregated", response_model=MagentoDataResponse)
def get_uk_aggregated_data(
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    search: str = Query(""),
    sort_by: str = Query("", description="Column to sort by"),
    sort_order: str = Query("desc", description="Sort order: asc or desc"),
    user=Depends(get_current_user)
):
    """Get UK aggregated magento data (6-month aggregated by SKU)"""
    result = svc.get_aggregated_data("uk", limit, offset, search, sort_by, sort_order)
    return MagentoDataResponse(**result)


@router.get("/fr/aggregated", response_model=MagentoDataResponse)
def get_fr_aggregated_data(
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    search: str = Query(""),
    sort_by: str = Query("", description="Column to sort by"),
    sort_order: str = Query("desc", description="Sort order: asc or desc"),
    user=Depends(get_current_user)
):
    """Get FR aggregated magento data (6-month aggregated by SKU)"""
    result = svc.get_aggregated_data("fr", limit, offset, search, sort_by, sort_order)
    return MagentoDataResponse(**result)


@router.get("/nl/aggregated", response_model=MagentoDataResponse)
def get_nl_aggregated_data(
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    search: str = Query(""),
    sort_by: str = Query("", description="Column to sort by"),
    sort_order: str = Query("desc", description="Sort order: asc or desc"),
    user=Depends(get_current_user)
):
    """Get NL aggregated magento data (6-month aggregated by SKU)"""
    result = svc.get_aggregated_data("nl", limit, offset, search, sort_by, sort_order)
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
    """Add a new SKU alias mapping. After adding, aggregated data will be automatically refreshed."""
    return svc.add_sku_alias(alias_sku, unified_sku)


@router.delete("/sku-aliases/{alias_id}")
def delete_sku_alias(
    alias_id: int,
    user=Depends(get_current_user)
):
    """Delete a SKU alias mapping. After deletion, aggregated data will be automatically refreshed."""
    return svc.delete_sku_alias(alias_id)


@router.post("/sku-aliases/auto-create-md-variants")
def auto_create_md_variant_aliases(user=Depends(get_current_user)):
    """Automatically create SKU aliases for MD variants to merge with their base SKUs. 
    This will make PROD123-MD magento data merge with PROD123 magento data."""
    return svc.auto_create_md_variant_aliases()


# Aggregated data refresh endpoints
@router.post("/refresh-aggregated")
def refresh_all_aggregated_data(user=Depends(get_current_user)):
    """Manually refresh aggregated data for all regions (UK, FR, NL)"""
    return svc.refresh_all_aggregated_data()


@router.post("/refresh-aggregated/{region}")
def refresh_aggregated_data_for_region(
    region: str,
    user=Depends(get_current_user)
):
    """Manually refresh aggregated data for a specific region"""
    return svc.refresh_aggregated_data_for_region(region)


@router.get("/{region}/aggregated/custom-range")
def get_custom_range_aggregated_data(
    region: str,
    range_type: str = Query(..., description="Type of range: 'days', 'months', or 'since'"),
    range_value: str = Query(..., description="Value for the range (number for days/months, date string for since)"),
    use_exclusions: bool = Query(True, description="Apply customer and group exclusions"),
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    search: str = Query(""),
    user=Depends(get_current_user)
):
    """Get aggregated magento data with custom date range"""
    result = svc.get_aggregated_data_custom_range(
        region, range_type, range_value, use_exclusions, limit, offset, search
    )
    return MagentoDataResponse(**result)


@router.post("/create-md-aliases")
def create_md_aliases(user=Depends(get_current_user)):
    """Manually trigger MD variant alias creation"""
    return svc.create_md_variant_aliases()


# ===== AGGREGATED MAGENTO FILTER ENDPOINTS =====

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
    """Get list of excluded customers for a region with their exclusion rules"""
    return svc.get_excluded_customers(region)


@router.post("/filters/customers/{region}")
def add_excluded_customer(
    region: str,
    email: str,
    full_name: str = "",
    rule_type: str = Query("exclude_all", description="Exclusion rule: exclude_all, divide_all, divide_product"),
    divisor: float = Query(2.0, description="Divisor for divide rules"),
    product_sku: str = Query(None, description="Product SKU for divide_product rule"),
    product_name: str = Query(None, description="Product name for divide_product rule"),
    user=Depends(get_current_user)
):
    """Add a customer to the exclusion list with optional rule configuration"""
    return svc.add_excluded_customer(region, email, full_name, user.get("username", "unknown"),
                                      rule_type, divisor, product_sku, product_name)


@router.put("/filters/customers/{customer_id}")
def update_excluded_customer_rule(
    customer_id: int,
    rule_type: str = Query(..., description="Exclusion rule: exclude_all, divide_all, divide_product"),
    divisor: float = Query(2.0, description="Divisor for divide rules"),
    product_sku: str = Query(None, description="Product SKU for divide_product rule"),
    product_name: str = Query(None, description="Product name for divide_product rule"),
    user=Depends(get_current_user)
):
    """Update the exclusion rule for an existing excluded customer"""
    return svc.update_excluded_customer_rule(customer_id, rule_type, divisor,
                                              product_sku, product_name, user.get("username", "unknown"))


@router.get("/filters/customer-products/{region}/{email}")
def get_customer_products(
    region: str,
    email: str,
    search: str = Query("", description="Search filter for products"),
    user=Depends(get_current_user)
):
    """Get products ordered by a specific customer (for exclusion rule product selection)"""
    return svc.get_customer_products(region, email, search)


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


@router.get("/filters/smart-qty-rules/{region}")
async def get_smart_qty_rules_endpoint(
    region: str,
    user=Depends(get_current_user)
):
    """Get all smart quantity rules for a region"""
    if region not in ['uk', 'fr', 'nl']:
        return {"status": "error", "message": "Invalid region"}
    
    result = svc.get_smart_qty_rules(region)
    return {"status": "success", "region": region, "rules": result}

@router.post("/filters/smart-qty-rules/{region}")
async def add_smart_qty_rule_endpoint(
    region: str,
    threshold: int = Query(..., ge=1),
    action: str = Query(...),
    divisor: float = Query(..., gt=0),
    user=Depends(get_current_user)
):
    """Add a smart quantity rule for a region"""
    if region not in ['uk', 'fr', 'nl']:
        return {"status": "error", "message": "Invalid region"}
    
    valid_actions = ['divide', 'multiply', 'subtract', 'set_to']
    if action not in valid_actions:
        return {"status": "error", "message": f"Invalid action. Must be one of: {valid_actions}"}
    
    # Check if user has permission (admin or manager)
    user_role = user.get("role", "").lower()
    if user_role not in ["admin", "manager"]:
        return {
            "status": "error",
            "message": "Only admins and managers can add smart quantity rules"
        }
    
    result = svc.add_smart_qty_rule(region, threshold, action, divisor, user.get("username", "unknown"))
    return result

@router.delete("/filters/smart-qty-rules/{rule_id}")
async def remove_smart_qty_rule_endpoint(
    rule_id: int,
    user=Depends(get_current_user)
):
    """Remove a specific smart quantity rule"""
    # Check if user has permission (admin or manager)
    user_role = user.get("role", "").lower()
    if user_role not in ["admin", "manager"]:
        return {
            "status": "error",
            "message": "Only admins and managers can remove smart quantity rules"
        }
    
    result = svc.remove_smart_qty_rule(rule_id)
    return result

@router.delete("/filters/smart-qty-rules/region/{region}")
async def clear_all_smart_qty_rules_endpoint(
    region: str,
    user=Depends(get_current_user)
):
    """Clear all smart quantity rules for a region"""
    if region not in ['uk', 'fr', 'nl']:
        return {"status": "error", "message": "Invalid region"}
    
    # Check if user has permission (admin or manager)
    user_role = user.get("role", "").lower()
    if user_role not in ["admin", "manager"]:
        return {
            "status": "error",
            "message": "Only admins and managers can clear smart quantity rules"
        }
    
    result = svc.clear_all_smart_qty_rules(region)
    return result


@router.get("/filters/status/available/{region}")
def get_available_statuses(
    region: str,
    user=Depends(get_current_user)
):
    """Get all available order statuses for a region"""
    return svc.get_available_statuses(region)


@router.get("/filters/status/excluded/{region}")
def get_excluded_statuses(
    region: str,
    user=Depends(get_current_user)
):
    """Get list of excluded order statuses for a region"""
    return svc.get_excluded_statuses(region)


@router.post("/filters/status/{region}")
def add_excluded_status(
    region: str,
    status: str = Query(...),
    user=Depends(get_current_user)
):
    """Add a status to the exclusion list"""
    return svc.add_excluded_status(region, status, user.get("username", "unknown"))


@router.delete("/filters/status/{status_id}")
def remove_excluded_status(
    status_id: int,
    user=Depends(get_current_user)
):
    """Remove a status from the exclusion list"""
    return svc.remove_excluded_status(status_id)


@router.get("/filters/smart-date-rules/{region}")
def get_smart_date_rules(
    region: str,
    user=Depends(get_current_user)
):
    """Get all smart date rules for a region"""
    result = svc.get_smart_date_rules(region)
    return {"status": "success", "region": region, "rules": result}

@router.post("/filters/smart-date-rules/{region}")
def add_smart_date_rule(
    region: str,
    start_date: str = Query(..., description="YYYY-MM-DD"),
    end_date: str = Query(..., description="YYYY-MM-DD"),
    action: str = Query(..., description="exclude, divide, multiply, set_to"),
    value: float = Query(None, description="Value for action"),
    user=Depends(get_current_user)
):
    """Add a smart date rule"""
    valid_actions = ['exclude', 'divide', 'multiply', 'set_to']
    if action not in valid_actions:
        return {"success": False, "message": f"Invalid action. Must be one of: {valid_actions}"}
    
    return svc.add_smart_date_rule(region, start_date, end_date, action, value or 0, user.get("username", "unknown"))

@router.delete("/filters/smart-date-rules/{rule_id}")
def remove_smart_date_rule(
    rule_id: int,
    user=Depends(get_current_user)
):
    """Remove a smart date rule"""
    return svc.remove_smart_date_rule(rule_id)

