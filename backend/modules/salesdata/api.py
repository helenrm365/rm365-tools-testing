from fastapi import APIRouter, Depends, UploadFile, File, Query
from typing import Dict, Any
from common.deps import get_current_user
from .service import SalesDataService
from .schemas import InitTablesResponse, SalesDataResponse, SalesDataImportResponse, ImportHistoryResponse

router = APIRouter()
svc = SalesDataService()


@router.get("/init", response_model=InitTablesResponse)
def initialize_tables(user=Depends(get_current_user)):
    """
    Initialize sales data tables (uk_sales_data, fr_sales_data, nl_sales_data).
    This endpoint is called when the sales data home page is accessed.
    """
    result = svc.initialize_tables()
    return InitTablesResponse(**result)


@router.get("/status")
def check_tables_status(user=Depends(get_current_user)):
    """
    Check which sales data tables exist in the database.
    """
    return svc.check_tables_status()


# UK Sales endpoints
@router.get("/uk", response_model=SalesDataResponse)
def get_uk_sales_data(
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    search: str = Query(""),
    user=Depends(get_current_user)
):
    """Get UK sales data with pagination and search"""
    result = svc.get_region_data("uk", limit, offset, search)
    return SalesDataResponse(**result)


@router.post("/uk/upload", response_model=SalesDataImportResponse)
async def upload_uk_sales_csv(
    file: UploadFile = File(...),
    user=Depends(get_current_user)
):
    """Upload CSV file for UK sales data"""
    content = await file.read()
    csv_content = content.decode('utf-8')
    username = user.get("username") or user.get("email") or "unknown"
    result = svc.import_csv("uk", csv_content, file.filename, username)
    return SalesDataImportResponse(**result)


# FR Sales endpoints
@router.get("/fr", response_model=SalesDataResponse)
def get_fr_sales_data(
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    search: str = Query(""),
    user=Depends(get_current_user)
):
    """Get FR sales data with pagination and search"""
    result = svc.get_region_data("fr", limit, offset, search)
    return SalesDataResponse(**result)


@router.post("/fr/upload", response_model=SalesDataImportResponse)
async def upload_fr_sales_csv(
    file: UploadFile = File(...),
    user=Depends(get_current_user)
):
    """Upload CSV file for FR sales data"""
    content = await file.read()
    csv_content = content.decode('utf-8')
    username = user.get("username") or user.get("email") or "unknown"
    result = svc.import_csv("fr", csv_content, file.filename, username)
    return SalesDataImportResponse(**result)


# NL Sales endpoints
@router.get("/nl", response_model=SalesDataResponse)
def get_nl_sales_data(
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    search: str = Query(""),
    user=Depends(get_current_user)
):
    """Get NL sales data with pagination and search"""
    result = svc.get_region_data("nl", limit, offset, search)
    return SalesDataResponse(**result)


@router.post("/nl/upload", response_model=SalesDataImportResponse)
async def upload_nl_sales_csv(
    file: UploadFile = File(...),
    user=Depends(get_current_user)
):
    """Upload CSV file for NL sales data"""
    content = await file.read()
    csv_content = content.decode('utf-8')
    username = user.get("username") or user.get("email") or "unknown"
    result = svc.import_csv("nl", csv_content, file.filename, username)
    return SalesDataImportResponse(**result)


# Condensed data endpoints (6-month aggregated by SKU)
@router.get("/uk/condensed", response_model=SalesDataResponse)
def get_uk_condensed_data(
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    search: str = Query(""),
    user=Depends(get_current_user)
):
    """Get UK condensed sales data (6-month aggregated by SKU)"""
    result = svc.get_condensed_data("uk", limit, offset, search)
    return SalesDataResponse(**result)


@router.get("/fr/condensed", response_model=SalesDataResponse)
def get_fr_condensed_data(
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    search: str = Query(""),
    user=Depends(get_current_user)
):
    """Get FR condensed sales data (6-month aggregated by SKU)"""
    result = svc.get_condensed_data("fr", limit, offset, search)
    return SalesDataResponse(**result)


@router.get("/nl/condensed", response_model=SalesDataResponse)
def get_nl_condensed_data(
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    search: str = Query(""),
    user=Depends(get_current_user)
):
    """Get NL condensed sales data (6-month aggregated by SKU)"""
    result = svc.get_condensed_data("nl", limit, offset, search)
    return SalesDataResponse(**result)


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
    This will make PROD123-MD sales data merge with PROD123 sales data."""
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
