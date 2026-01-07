from __future__ import annotations
from typing import Any, Dict, Optional
from fastapi import APIRouter, Depends, HTTPException, Path, Body, Query


from common.deps import get_current_user, inventory_conn
from modules.labels.repo import LabelsRepo
from modules.labels.schemas import (
    DeleteJobsRequest, 
    DeleteJobsResponse,
    LabelPresetCreate,
    LabelPresetUpdate,
    LabelPresetOut,
    LabelPresetsResponse
)

from modules.labels.jobs import start_label_job, get_label_job_rows, delete_label_job, delete_label_jobs, _ensure_label_print_schema
from modules.labels.print_csv import stream_csv_labels
from modules.labels.print_pdf import stream_pdf_labels

router = APIRouter()


@router.get("/health")
def labels_health():
    """
    Check if labels module is ready.
    """
    return {
        "status": "ready", 
        "message": "Labels module ready"
    }

@router.get("/to-print")
def labels_to_print(
    discontinued_statuses: Optional[str] = None,
    region: str = Query("uk", regex="^(uk|fr|nl)$"),
    user=Depends(get_current_user)
):
    """
    Return label rows for Magento products filtered by discontinued_status.
    Base/MD collapse + inventory_metadata + 6M enrichment handled in repo.
    
    Args:
        discontinued_statuses: Comma-separated list of statuses (e.g., "Active,Temporarily OOS")
                              Defaults to: Active, Temporarily OOS, Pre Order, Samples
        region: Region preference for pricing/names ("uk", "fr", or "nl"). Defaults to "uk".
                SKUs always come from UK Magento, but prices/names can come from any region.
                6M data: from inventory_metadata (UK separate, FR+NL combined).
    """
    try:
        # Parse discontinued_statuses if provided
        status_list = None
        if discontinued_statuses:
            status_list = [s.strip() for s in discontinued_statuses.split(',') if s.strip()]
        
        with inventory_conn() as conn:
            return LabelsRepo().get_labels_to_print_psycopg(
                conn, 
                status_list, 
                preferred_region=region
            )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to generate labels: {e}"
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
        
        with inventory_conn() as conn:
            job_id = start_label_job(conn, payload)
            
            # Verify items were inserted
            with conn.cursor() as cur:
                cur.execute("SELECT COUNT(*) FROM label_print_items WHERE job_id = %s", (job_id,))
                item_count = cur.fetchone()[0]
            
            
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

@router.delete("/jobs")
def delete_print_jobs(
        request: DeleteJobsRequest,
        user=Depends(get_current_user)
) -> DeleteJobsResponse:
    """
    # Delete multiple print jobs or all jobs at once.
    # Provide either job_ids list or set delete_all to true.
    """
    try:
        if not request.delete_all and not request.job_ids:
            raise HTTPException(
                status_code=400,
                detail="Either provide job_ids or set delete_all to true"
            )
        
        with inventory_conn() as conn:
            deleted_count = delete_label_jobs(conn, request.job_ids, request.delete_all)
            
            if request.delete_all:
                message = f"Successfully deleted all {deleted_count} label print jobs"
            else:
                message = f"Successfully deleted {deleted_count} label print job(s)"
            
            return DeleteJobsResponse(
                status="success",
                deleted_count=deleted_count,
                message=message
            )
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        error_detail = f"Failed to delete print jobs: {str(e)}\n{traceback.format_exc()}"
        print(f"[Labels API] Error: {error_detail}")
        raise HTTPException(
            status_code=500,
            detail=error_detail
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


# === Label Printing Presets Endpoints ===

@router.get("/presets", response_model=LabelPresetsResponse)
def get_label_presets(user=Depends(get_current_user)):
    """
    Get all label printing presets.
    Presets are global and available to all users.
    """
    try:
        with inventory_conn() as conn:
            _ensure_label_print_schema(conn)
            presets = LabelsRepo.get_all_presets(conn)
            return LabelPresetsResponse(
                status="success",
                presets=presets,
                count=len(presets)
            )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to fetch presets: {e}"
        )


@router.get("/presets/{preset_id}", response_model=LabelPresetOut)
def get_label_preset(
    preset_id: int = Path(..., title="Preset ID"),
    user=Depends(get_current_user)
):
    """
    Get a specific label printing preset by ID.
    """
    try:
        with inventory_conn() as conn:
            _ensure_label_print_schema(conn)
            preset = LabelsRepo.get_preset_by_id(conn, preset_id)
            if not preset:
                raise HTTPException(
                    status_code=404,
                    detail=f"Preset {preset_id} not found"
                )
            return preset
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to fetch preset: {e}"
        )


@router.post("/presets", response_model=LabelPresetOut)
def create_label_preset(
    preset: LabelPresetCreate,
    user=Depends(get_current_user)
):
    """
    Create a new label printing preset.
    Presets are global and can be used by all users.
    """
    try:
        with inventory_conn() as conn:
            _ensure_label_print_schema(conn)
            preset_id = LabelsRepo.create_preset(
                conn,
                name=preset.name,
                description=preset.description,
                status_filters=preset.status_filters,
                region=preset.region,
                product_skus=preset.product_skus,
                created_by=user.get('email')
            )
            conn.commit()
            
            # Fetch and return the created preset
            created_preset = LabelsRepo.get_preset_by_id(conn, preset_id)
            return created_preset
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to create preset: {e}"
        )


@router.put("/presets/{preset_id}", response_model=LabelPresetOut)
def update_label_preset(
    preset_id: int = Path(..., title="Preset ID"),
    preset_update: LabelPresetUpdate = Body(...),
    user=Depends(get_current_user)
):
    """
    Update an existing label printing preset.
    Only provided fields will be updated.
    """
    try:
        with inventory_conn() as conn:
            _ensure_label_print_schema(conn)
            # Check if preset exists
            existing = LabelsRepo.get_preset_by_id(conn, preset_id)
            if not existing:
                raise HTTPException(
                    status_code=404,
                    detail=f"Preset {preset_id} not found"
                )
            
            # Update the preset
            updated = LabelsRepo.update_preset(
                conn,
                preset_id=preset_id,
                name=preset_update.name,
                description=preset_update.description,
                status_filters=preset_update.status_filters,
                region=preset_update.region,
                product_skus=preset_update.product_skus
            )
            
            if not updated:
                raise HTTPException(
                    status_code=400,
                    detail="No fields to update"
                )
            
            conn.commit()
            
            # Fetch and return the updated preset
            updated_preset = LabelsRepo.get_preset_by_id(conn, preset_id)
            return updated_preset
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to update preset: {e}"
        )


@router.delete("/presets/{preset_id}")
def delete_label_preset(
    preset_id: int = Path(..., title="Preset ID"),
    user=Depends(get_current_user)
):
    """
    Delete a label printing preset.
    """
    try:
        with inventory_conn() as conn:
            _ensure_label_print_schema(conn)
            deleted = LabelsRepo.delete_preset(conn, preset_id)
            
            if not deleted:
                raise HTTPException(
                    status_code=404,
                    detail=f"Preset {preset_id} not found"
                )
            
            conn.commit()
            
            return {
                "status": "success",
                "message": f"Preset {preset_id} deleted successfully"
            }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to delete preset: {e}"
        )
