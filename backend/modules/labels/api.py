from __future__ import annotations
from typing import Any, Dict, Optional
from fastapi import APIRouter, Depends, HTTPException, Path, Body, Query


from common.deps import get_current_user, inventory_conn
from modules._integrations.zoho.client import get_zoho_items_with_skus, get_zoho_items_with_skus_full
from modules.labels.repo import LabelsRepo
from modules.salesdata.service import SalesDataService

from modules.labels.jobs import start_label_job, get_label_job_rows, delete_label_job
from modules.labels.print_csv import stream_csv_labels
from modules.labels.print_pdf import stream_pdf_labels


router = APIRouter()


@router.get("/health")
def labels_health():
    """
    Check if labels module is ready and provide status information.
    """
    try:
        from common.deps import inventory_conn
        
        with inventory_conn() as conn:
            cursor = conn.cursor()
            # Check if required sales tables exist
            cursor.execute("""
                SELECT table_name 
                FROM information_schema.tables 
                WHERE table_schema = 'public' 
                AND table_name IN ('uk_sales_data', 'fr_sales_data', 'nl_sales_data')
            """)
            
            existing_tables = [row[0] for row in cursor.fetchall()]
            
            if not existing_tables:
                return {
                    "status": "warning",
                    "message": "Labels module ready, but sales data not initialized",
                    "recommendation": "Initialize sales data tables first at /salesdata/init",
                    "sales_tables_exist": False,
                    "existing_sales_tables": []
                }
            else:
                return {
                    "status": "ready", 
                    "message": "Labels module fully ready",
                    "sales_tables_exist": True,
                    "existing_sales_tables": existing_tables
                }
    except Exception as e:
        return {
            "status": "error",
            "message": f"Health check failed: {e}",
            "sales_tables_exist": False
        }

@router.post("/init-dependencies")
def init_label_dependencies(user=Depends(get_current_user)):
    """
    Initialize dependencies needed for label generation (sales data tables).
    """
    try:
        # Initialize sales data tables
        sales_service = SalesDataService()
        result = sales_service.initialize_tables()
        
        if result.get("status") == "success":
            return {
                "status": "success",
                "message": "Dependencies initialized successfully. Label generation is now ready.",
                "details": result
            }
        else:
            return {
                "status": "error", 
                "message": "Failed to initialize dependencies",
                "details": result
            }
    except Exception as e:
        return {
            "status": "error",
            "message": f"Failed to initialize dependencies: {e}"
        }

@router.get("/to-print")
def labels_to_print(
    discontinued_statuses: Optional[str] = None,
    region: str = Query("uk", regex="^(uk|fr|nl)$"),
    user=Depends(get_current_user)
):
    """
    Return label rows for Magento products filtered by discontinued_status.
    Base/MD collapse + Zoho + 6M enrichment handled in repo.
    
    Args:
        discontinued_statuses: Comma-separated list of statuses (e.g., "Active,Temporarily OOS")
                              Defaults to: Active, Temporarily OOS, Pre Order, Samples
        region: Region preference for pricing/names ("uk", "fr", or "nl"). Defaults to "uk".
                SKUs always come from UK Magento, but prices/names can come from any region.
                6M data: UK separate, FR+NL combined.
    """
    try:
        # Parse discontinued_statuses if provided
        status_list = None
        if discontinued_statuses:
            status_list = [s.strip() for s in discontinued_statuses.split(',') if s.strip()]
        
        zoho_map = get_zoho_items_with_skus_full()
        with inventory_conn() as conn:
            return LabelsRepo().get_labels_to_print_psycopg(
                conn, 
                zoho_map, 
                status_list, 
                preferred_region=region
            )
    except Exception as e:
        error_msg = str(e)
        
        # Check if it's a sales data table missing error
        if "Sales data tables not initialized" in error_msg:
            raise HTTPException(
                status_code=503,
                detail="Sales data tables not initialized. Please go to Sales Data module and click 'Initialize Tables' first, then try generating labels again."
            )
        if "uk_sales_data" in error_msg and "does not exist" in error_msg:
            raise HTTPException(
                status_code=503,
                detail="Sales data tables not initialized. Please go to Sales Data module and click 'Initialize Tables' first, then try generating labels again."
            )
        else:
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