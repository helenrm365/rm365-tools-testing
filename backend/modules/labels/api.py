from __future__ import annotations
from typing import List
from datetime import date

from fastapi import APIRouter, Depends, Query, HTTPException
from fastapi.responses import Response

from common.deps import get_current_user
from .schemas import LabelRequest, LabelDataResponse, LabelGenerateResponse, RecentRunsResponse
from .service import LabelsService

from sqlalchemy.orm import Session
from core.db import get_db                   # SQLAlchemy session dep
from modules.labels.repo import LabelsRepo
from modules.sales_imports.sales_sync import get_zoho_items_with_skus_full


router = APIRouter()

def _svc() -> LabelsService:
    return LabelsService()

@router.get("/health")
def labels_health():
    return {"status": "Labels module ready"}

@router.get("/data", response_model=LabelDataResponse)
def get_label_data(
    start_date: date = Query(..., description="Start date"),
    end_date: date = Query(..., description="End date"),
    search: str = Query("", description="Search term"),
    user=Depends(get_current_user)
):
    """Get filtered sales data for label generation"""
    result = _svc().get_label_data(
        start_date=start_date.isoformat(),
        end_date=end_date.isoformat(),
        search=search
    )
    return LabelDataResponse(**result)

@router.post("/generate", response_model=LabelGenerateResponse)
def generate_labels(
    body: LabelRequest,
    user=Depends(get_current_user)
):
    """Generate labels for the specified date range and criteria"""
    result = _svc().generate_labels(
        start_date=body.start_date.isoformat(),
        end_date=body.end_date.isoformat(),
        search=body.search or ""
    )
    
    if result["status"] == "success":
        # Save to history
        _svc().save_run_history({
            "start_date": body.start_date.isoformat(),
            "end_date": body.end_date.isoformat(),
            "search_term": body.search or "",
            "labels_count": result.get("count", 0),
            "status": "completed"
        })
    
    return LabelGenerateResponse(**result)

@router.get("/download")
def download_labels(
    start_date: date = Query(..., description="Start date"),
    end_date: date = Query(..., description="End date"),
    search: str = Query("", description="Search term"),
    format: str = Query("csv", description="Format: csv, shipping, product"),
    user=Depends(get_current_user)
):
    """Download labels as file"""
    result = _svc().generate_labels(
        start_date=start_date.isoformat(),
        end_date=end_date.isoformat(),
        search=search
    )
    
    if result["status"] != "success":
        raise HTTPException(status_code=400, detail=result.get("message", "Failed to generate labels"))
    
    content = result["content"]
    filename = f"labels_{start_date}_{end_date}.csv"
    
    if format == "shipping":
        from .generator import generate_shipping_labels
        data = _svc().get_label_data(start_date.isoformat(), end_date.isoformat(), search)
        content = generate_shipping_labels(data.get("data", []))
        filename = f"shipping_labels_{start_date}_{end_date}.txt"
    elif format == "product":
        from .generator import generate_product_labels
        data = _svc().get_label_data(start_date.isoformat(), end_date.isoformat(), search)
        content = generate_product_labels(data.get("data", []))
        filename = f"product_labels_{start_date}_{end_date}.txt"
    
    return Response(
        content=content,
        media_type="application/octet-stream",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )

@router.get("/history", response_model=RecentRunsResponse)
def get_label_history(
    limit: int = Query(10, description="Number of recent runs to return"),
    user=Depends(get_current_user)
):
    """Get recent label generation history"""
    runs = _svc().get_recent_runs(limit)
    return RecentRunsResponse(runs=runs)
