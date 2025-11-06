from __future__ import annotations
from typing import Any, Dict, Optional
from fastapi import APIRouter, Depends, HTTPException, Path, Body, Query


from common.deps import get_current_user, inventory_conn
from modules._integrations.zoho.client import get_zoho_items_with_skus, get_zoho_items_with_skus_full
from modules.labels.repo import LabelsRepo

from modules.labels.jobs import start_label_job, get_label_job_rows, delete_label_job
from modules.labels.print_csv import stream_csv_labels
from modules.labels.print_pdf import stream_pdf_labels


router = APIRouter()


@router.get("/health")
def labels_health():
    return {"status": "Labels module ready"}

@router.get("/to-print")
def labels_to_print(
    discontinued_statuses: Optional[str] = None,
    user=Depends(get_current_user)
):
    """
    Return label rows for Magento products filtered by discontinued_status.
    Base/MD collapse + Zoho + 6M enrichment handled in repo.
    
    Args:
        discontinued_statuses: Comma-separated list of statuses (e.g., "Active,Temporarily OOS")
                              Defaults to: Active, Temporarily OOS, Pre Order, Samples
    """
    try:
        # Parse discontinued_statuses if provided
        status_list = None
        if discontinued_statuses:
            status_list = [s.strip() for s in discontinued_statuses.split(',') if s.strip()]
        
        zoho_map = get_zoho_items_with_skus_full()
        with inventory_conn() as conn:
            return LabelsRepo().get_labels_to_print_psycopg(conn, zoho_map, status_list)
    except Exception as e:
        raise HTTPException(
            status_code=503,
            detail=f"Zoho lookup / DB failed: {e}"
        )

@router.get("/job/{job_id}")
def get_print_job(
        job_id: int = Path(..., title="Label print job ID"),
        user=Depends(get_current_user)
):
    """
    # Fetch all label rows in a given print job ID.
    """
    try:
        with inventory_conn() as conn:
            rows = get_label_job_rows(conn, job_id)
            return {"job_id": job_id, "rows": rows}
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to load print job: {e}"
        )

@router.post("/start-job")
def start_print_job(
        payload: Dict[str, Any] = Body(...),
        user=Depends(get_current_user),
):
    """
    # Create a new label print job with optional line_date values.
    """
    try:
        with inventory_conn() as conn:
            zoho_map = get_zoho_items_with_skus_full()
            job_id = start_label_job(conn, zoho_map, payload)
            return {"status": "ok", "job_id": job_id}
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to start print job: {e}"
        )

@router.delete("/job/{job_id}")
def delete_print_job(
        job_id: int = Path(..., title="Label print job ID"),
        user=Depends(get_current_user)
):
    """
    # Delete a print job and all associated rows.
    """
    try:
        with inventory_conn() as conn:
            delete_label_job(conn, job_id)
            return {"status": "deleted", "job_id": job_id}
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to delete print job: {e}"
        )

@router.get("/job/{job_id}/pdf")
def download_labels_pdf(
        job_id: int = Path(..., title="Label print job ID"),
        user=Depends(get_current_user)
):
    """
    # Generate PDF label sheet for a print job.
    """
    try:
        with inventory_conn() as conn:
            return stream_pdf_labels(conn, job_id)
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to generate PDF: {e}"
        )

@router.get("/job/{job_id}/csv")
def download_labels_csv(
        job_id: int = Path(..., title="Label print job ID"),
        user=Depends(get_current_user)
):
    """
    # Export label data for a print job as CSV.
    """
    try:
        with inventory_conn() as conn:
            return stream_csv_labels(conn, job_id)
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to generate CSV: {e}"
        )