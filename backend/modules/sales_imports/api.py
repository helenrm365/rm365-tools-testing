from fastapi import APIRouter, Depends, UploadFile, File, Query
from typing import Dict, Any
from common.deps import get_current_user
from .service import SalesImportsService
from .schemas import InitTablesResponse, SalesDataResponse, SalesImportResponse

router = APIRouter()
svc = SalesImportsService()


@router.get("/init", response_model=InitTablesResponse)
def initialize_tables(user=Depends(get_current_user)):
    """
    Initialize sales import tables (uk_sales_data, fr_sales_data, nl_sales_data).
    This endpoint is called when the sales imports home page is accessed.
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


@router.post("/uk/upload", response_model=SalesImportResponse)
async def upload_uk_sales_csv(
    file: UploadFile = File(...),
    user=Depends(get_current_user)
):
    """Upload CSV file for UK sales data"""
    content = await file.read()
    csv_content = content.decode('utf-8')
    result = svc.import_csv("uk", csv_content)
    return SalesImportResponse(**result)


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


@router.post("/fr/upload", response_model=SalesImportResponse)
async def upload_fr_sales_csv(
    file: UploadFile = File(...),
    user=Depends(get_current_user)
):
    """Upload CSV file for FR sales data"""
    content = await file.read()
    csv_content = content.decode('utf-8')
    result = svc.import_csv("fr", csv_content)
    return SalesImportResponse(**result)


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


@router.post("/nl/upload", response_model=SalesImportResponse)
async def upload_nl_sales_csv(
    file: UploadFile = File(...),
    user=Depends(get_current_user)
):
    """Upload CSV file for NL sales data"""
    content = await file.read()
    csv_content = content.decode('utf-8')
    result = svc.import_csv("nl", csv_content)
    return SalesImportResponse(**result)


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
