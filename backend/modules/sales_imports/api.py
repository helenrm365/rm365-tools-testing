from __future__ import annotations
from typing import List

from fastapi import APIRouter, Depends, UploadFile, File, Query, HTTPException

from common.deps import get_current_user
from .schemas import ImportResponse, ValidationResponse, SalesOrdersResponse, ImportHistoryResponse, DeleteResponse, UKSalesDataResponse
from .service import SalesImportsService

router = APIRouter()

def _svc() -> SalesImportsService:
    return SalesImportsService()

@router.get("/health")
def sales_imports_health():
    return {"status": "Sales imports module ready"}

@router.post("/upload", response_model=ImportResponse)
async def upload_csv(
    file: UploadFile = File(...),
    user=Depends(get_current_user)
):
    """Upload and import CSV file with sales data"""
    
    if not file.filename.lower().endswith('.csv'):
        raise HTTPException(status_code=400, detail="Only CSV files are allowed")
    
    try:
        content = await file.read()
        file_content = content.decode('utf-8')
        
        result = _svc().import_csv_file(file_content, file.filename)
        return ImportResponse(**result)
        
    except UnicodeDecodeError:
        raise HTTPException(status_code=400, detail="Invalid file encoding. Please use UTF-8 encoded CSV files.")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error processing file: {str(e)}")

@router.post("/validate", response_model=ValidationResponse)
async def validate_csv(
    file: UploadFile = File(...),
    user=Depends(get_current_user)
):
    """Validate CSV file format without importing"""
    
    if not file.filename.lower().endswith('.csv'):
        raise HTTPException(status_code=400, detail="Only CSV files are allowed")
    
    try:
        content = await file.read()
        file_content = content.decode('utf-8')
        
        result = _svc().validate_csv_format(file_content)
        return ValidationResponse(**result)
        
    except UnicodeDecodeError:
        raise HTTPException(status_code=400, detail="Invalid file encoding. Please use UTF-8 encoded CSV files.")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error validating file: {str(e)}")

@router.get("/orders", response_model=SalesOrdersResponse)
def get_sales_orders(
    limit: int = Query(100, description="Maximum number of orders to return"),
    search: str = Query("", description="Search term"),
    user=Depends(get_current_user)
):
    """Get sales orders with optional search"""
    orders = _svc().get_sales_orders(limit, search)
    return SalesOrdersResponse(orders=orders, count=len(orders))

@router.delete("/orders/{order_id}", response_model=DeleteResponse)
def delete_sales_order(
    order_id: int,
    user=Depends(get_current_user)
):
    """Delete a sales order"""
    result = _svc().delete_sales_order(order_id)
    return DeleteResponse(**result)

@router.get("/history", response_model=ImportHistoryResponse)
def get_import_history(
    limit: int = Query(20, description="Number of recent imports to return"),
    user=Depends(get_current_user)
):
    """Get import history"""
    history = _svc().get_import_history(limit)
    return ImportHistoryResponse(history=history)

@router.get("/template")
def download_template(user=Depends(get_current_user)):
    """Download CSV template file"""
    from fastapi.responses import Response
    
    template_content = """order_number,created_at,sku,name,qty,price,status
ORD-001,2024-10-17,SKU-123,Widget Pro,5,29.99,completed
ORD-002,2024-10-17,SKU-456,Gadget Plus,10,19.99,pending
ORD-003,2024-10-17,SKU-789,Device Elite,2,149.99,completed"""
    
    return Response(
        content=template_content,
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=sales_import_template.csv"}
    )

@router.get("/uk-sales", response_model=UKSalesDataResponse)
def get_uk_sales_data(
    limit: int = Query(100, description="Number of records per page"),
    offset: int = Query(0, description="Offset for pagination"),
    search: str = Query("", description="Search term"),
    user=Depends(get_current_user)
):
    """Get UK sales data with pagination and search"""
    result = _svc().get_uk_sales_data(limit, offset, search)
    return UKSalesDataResponse(**result)