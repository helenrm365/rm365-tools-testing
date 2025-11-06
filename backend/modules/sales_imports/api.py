from fastapi import APIRouter, Depends
from typing import Dict, Any
from common.deps import get_current_user
from .service import SalesImportsService
from .schemas import InitTablesResponse

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
