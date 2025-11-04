from __future__ import annotations
from typing import Any, Dict
from fastapi import APIRouter, Depends, HTTPException, Path, Body
from fastapi.responses import StreamingResponse

from common.deps import get_current_user, inventory_conn
from modules._integrations.zoho.client import get_zoho_items_with_skus
from modules.labels.repo import LabelsRepo
from modules.labels.jobs import start_label_job, get_label_job_rows, delete_label_job
from modules.labels.print_pdf import stream_pdf_labels
from modules.labels.print_csv import stream_csv_labels

router = APIRouter()


@router.get("/health")
def labels_health():
    return {"status": "Labels module ready"}


@router.get("/to-print")
def labels_to_print(user=Depends(get_current_user)):
    """
    Return label rows for active Magento products (discontinued ∈ {No, Temporarily OOS}).
    Base/MD collapse + Zoho + 6M enrichment handled in repo.
    """
    try:
        zoho_map = get_zoho_items_with_skus()
        with inventory_conn() as conn:
            return LabelsRepo().get_labels_to_print_psycopg(conn, zoho_map)
    except Exception as e:
        raise HTTPException(
            status_code=503,
            detail=f"Zoho lookup / DB failed: {e}"
        )


@router.post("/start-job")
def start_print_job(
        payload: Dict[str, Any] = Body(...),
        user=Depends(get_current_user),
):
    """
    Create a new label print job with optional line_date values.
    """
    try:
        with inventory_conn() as conn:
            zoho_map = get_zoho_items_with_skus()
            job_id = start_label_job(conn, zoho_map, payload)
            return {"status": "ok", "job_id": job_id}
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to start print job: {e}"
        )


@router.get("/job/{job_id}")
def get_print_job(
        job_id: int = Path(..., title="Label print job ID"),
        user=Depends(get_current_user)
):
    """
    Fetch all label rows in a given print job ID.
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


@router.delete("/job/{job_id}")
def delete_print_job(
        job_id: int = Path(..., title="Label print job ID"),
        user=Depends(get_current_user)
):
    """
    Delete a print job and all associated rows.
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
    Generate PDF label sheet for a print job.
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
    Export label data for a print job as CSV.
    """
    try:
        with inventory_conn() as conn:
            return stream_csv_labels(conn, job_id)
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to generate CSV: {e}"
        )