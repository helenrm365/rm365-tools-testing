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

@router.get("/jobs")
def list_print_jobs(
        limit: int = Query(10, ge=1, le=100),
        user=Depends(get_current_user)
):
    """
    # List recent label print jobs with summary info
    """
    try:
        with inventory_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT 
                        j.id,
                        j.created_by,
                        j.line_date,
                        j.created_at,
                        COUNT(i.id) as item_count,
                        SUM(i.uk_6m_data) as total_uk_6m,
                        SUM(i.fr_6m_data) as total_fr_6m
                    FROM label_print_jobs j
                    LEFT JOIN label_print_items i ON j.id = i.job_id
                    GROUP BY j.id, j.created_by, j.line_date, j.created_at
                    ORDER BY j.created_at DESC
                    LIMIT %s
                    """,
                    (limit,)
                )
                cols = [c[0] for c in cur.description]
                jobs = [dict(zip(cols, row)) for row in cur.fetchall()]
                
                # Convert datetime to ISO string for JSON serialization
                for job in jobs:
                    if job.get('created_at'):
                        job['created_at'] = job['created_at'].isoformat()
                    if job.get('line_date'):
                        job['line_date'] = str(job['line_date'])
                
                return {"jobs": jobs, "count": len(jobs)}
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to list print jobs: {e}"
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
        print(f"[Labels API] Creating print job with payload: {payload}")
        
        with inventory_conn() as conn:
            zoho_map = get_zoho_items_with_skus_full()
            print(f"[Labels API] Zoho map loaded with {len(zoho_map)} items")
            
            job_id = start_label_job(conn, zoho_map, payload)
            
            # Verify items were inserted
            with conn.cursor() as cur:
                cur.execute("SELECT COUNT(*) FROM label_print_items WHERE job_id = %s", (job_id,))
                item_count = cur.fetchone()[0]
            
            print(f"[Labels API] Created job {job_id} with {item_count} items")
            
            return {
                "status": "ok", 
                "job_id": job_id,
                "item_count": item_count,
                "message": f"Successfully created print job with {item_count} labels"
            }
    except Exception as e:
        import traceback
        error_detail = f"Failed to start print job: {str(e)}\n{traceback.format_exc()}"
        print(f"[Labels API] Error: {error_detail}")
        raise HTTPException(
            status_code=500,
            detail=error_detail
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
            # First verify the job exists and has items
            with conn.cursor() as cur:
                cur.execute("SELECT COUNT(*) FROM label_print_items WHERE job_id = %s", (job_id,))
                count = cur.fetchone()[0]
                if count == 0:
                    raise HTTPException(
                        status_code=404,
                        detail=f"No label items found for job {job_id}. The job may be empty or not exist."
                    )
            
            return stream_pdf_labels(conn, job_id)
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        error_detail = f"Failed to generate PDF: {str(e)}\n{traceback.format_exc()}"
        print(f"[Labels API] PDF generation error: {error_detail}")
        raise HTTPException(
            status_code=500,
            detail=error_detail
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