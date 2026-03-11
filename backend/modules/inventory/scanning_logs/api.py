"""
API endpoints for scanning logs
"""
from fastapi import APIRouter, Depends, Query, HTTPException
from typing import Optional, List
from datetime import datetime, timedelta
import logging

from core.auth import get_current_user
from .repo import ScanningLogsRepo
from .schemas import (
    CreateSubmissionRequest,
    SubmissionOut,
    SubmissionListResponse,
    LogSearchParams
)

logger = logging.getLogger(__name__)
router = APIRouter(tags=["scanning-logs"])  # No prefix here - added in app.py

# Initialize repo and tables on module load
repo = ScanningLogsRepo()

@router.on_event("startup")
async def init_tables():
    """Initialize scanning logs tables on startup"""
    try:
        repo.init_tables()
        logger.info("Scanning logs tables initialized")
    except Exception as e:
        logger.error(f"Failed to initialize scanning logs tables: {e}")


# ── Static-path routes (must come before /{branch} catch-all) ────────────────

@router.get("/chart/daily-counts")
async def get_daily_counts(
    date_from: Optional[datetime] = Query(None, description="Start date (defaults to Monday of current week)"),
    date_to: Optional[datetime] = Query(None, description="End date (defaults to Sunday of current week)"),
    branches: Optional[str] = Query(None, description="Comma-separated branch IDs to include"),
    reasons: Optional[str] = Query(None, description="Comma-separated reasons to include"),
    current_user: dict = Depends(get_current_user)
):
    """
    Get daily submission counts for the line chart on the dashboard.

    Returns counts grouped by date, branch and reason.
    Defaults to the current week (Mon-Sun) and all branches/reasons.
    """
    try:
        all_branches = ["uk-birmingham", "uk-london", "fr-paris"]
        all_reasons = ["Order", "Return", "Stock Re-evaluation"]

        # Parse branch filter
        branch_list = all_branches
        if branches:
            branch_list = [b.strip() for b in branches.split(",") if b.strip() in all_branches]
            if not branch_list:
                branch_list = all_branches

        # Parse reason filter
        reason_list = all_reasons
        if reasons:
            reason_list = [r.strip() for r in reasons.split(",") if r.strip() in all_reasons]
            if not reason_list:
                reason_list = all_reasons

        # Default date range: current week (Monday to Sunday end-of-day)
        if not date_from:
            today = datetime.utcnow().date()
            monday = today - timedelta(days=today.weekday())
            date_from = datetime.combine(monday, datetime.min.time())
        if not date_to:
            date_to_date = date_from.date() + timedelta(days=6) if hasattr(date_from, 'date') else date_from + timedelta(days=6)
            if hasattr(date_to_date, 'date'):
                date_to_date = date_to_date
            date_to = datetime.combine(date_to_date, datetime.max.time())
        else:
            # Extend date_to to end of day
            if hasattr(date_to, 'date'):
                date_to = datetime.combine(date_to.date(), datetime.max.time())

        data = repo.get_daily_counts(
            branches=branch_list,
            reasons=reason_list,
            date_from=date_from,
            date_to=date_to
        )

        return {
            "data": data,
            "date_from": date_from.isoformat(),
            "date_to": date_to.isoformat(),
            "branches": branch_list,
            "reasons": reason_list
        }

    except Exception as e:
        logger.error(f"Error getting daily counts for chart: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/all/logs", response_model=SubmissionListResponse)
async def get_all_submissions(
    search: Optional[str] = Query(None, description="Search by SKU, item ID, or product name"),
    user: Optional[str] = Query(None, description="Filter by username"),
    date_from: Optional[datetime] = Query(None, description="Filter from date"),
    date_to: Optional[datetime] = Query(None, description="Filter to date"),
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    current_user: dict = Depends(get_current_user)
):
    """
    Get scanning log submissions across all branches
    
    Similar to branch-specific endpoint but returns logs from all branches.
    """
    try:
        branches = ["uk-birmingham", "uk-london", "fr-paris"]
        combined = []

        for branch in branches:
            branch_result = repo.get_submissions(
                branch=branch,
                search=search,
                user=user,
                date_from=date_from,
                date_to=date_to,
                page=1,
                per_page=1000
            )
            combined.extend(branch_result.get("submissions", []))

        # Sort by submitted_at desc
        def parse_ts(ts):
            try:
                return datetime.fromisoformat(ts) if ts else datetime.min
            except Exception:
                return datetime.min

        combined.sort(key=lambda item: parse_ts(item.get("submitted_at")), reverse=True)

        total = len(combined)
        start = (page - 1) * per_page
        end = start + per_page
        paged = combined[start:end]

        total_pages = (total + per_page - 1) // per_page if per_page > 0 else 1

        return {
            "submissions": paged,
            "total": total,
            "page": page,
            "per_page": per_page,
            "total_pages": total_pages
        }
        
    except Exception as e:
        logger.error(f"Error getting all submissions: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ── Branch-parameterized routes ──────────────────────────────────────────────

@router.post("/{branch}/log", response_model=SubmissionOut)
async def create_submission(
    branch: str,
    request: CreateSubmissionRequest,
    current_user: dict = Depends(get_current_user)
):
    """
    Log a scanner submission for a branch
    
    This endpoint records a complete submission with all scanned items,
    their quantities (positive for adding, negative for removing),
    and allocation details (which shelves were affected).
    """
    try:
        # Convert pydantic models to dicts for repo
        items = [item.model_dump() for item in request.items]
        
        # Get username from current user
        submitted_by = current_user.get('username') or current_user.get('email') or 'unknown'
        
        result = repo.create_submission(
            branch=branch,
            reason=request.reason,
            submitted_by=submitted_by,
            items=items
        )
        
        return result
        
    except Exception as e:
        logger.error(f"Error creating submission for {branch}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{branch}/logs", response_model=SubmissionListResponse)
async def get_submissions(
    branch: str,
    search: Optional[str] = Query(None, description="Search by SKU, item ID, or product name"),
    user: Optional[str] = Query(None, description="Filter by username"),
    date_from: Optional[datetime] = Query(None, description="Filter from date"),
    date_to: Optional[datetime] = Query(None, description="Filter to date"),
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    current_user: dict = Depends(get_current_user)
):
    """
    Get scanning log submissions for a branch
    
    Supports filtering by:
    - search: Find submissions containing items matching SKU, item ID, or product name
    - user: Filter by the user who submitted
    - date_from/date_to: Filter by submission date range
    """
    try:
        result = repo.get_submissions(
            branch=branch,
            search=search,
            user=user,
            date_from=date_from,
            date_to=date_to,
            page=page,
            per_page=per_page
        )
        return result
        
    except Exception as e:
        logger.error(f"Error getting submissions for {branch}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{branch}/logs/{submission_id}", response_model=SubmissionOut)
async def get_submission_detail(
    branch: str,
    submission_id: int,
    current_user: dict = Depends(get_current_user)
):
    """
    Get detailed information about a specific submission
    
    Returns the submission with all its items, including allocation details
    showing exactly which shelves were affected and by how much.
    """
    try:
        result = repo.get_submission_by_id(submission_id, branch)
        
        if not result:
            raise HTTPException(status_code=404, detail="Submission not found")
        
        # Verify branch matches
        if result['branch'] != branch:
            raise HTTPException(status_code=404, detail="Submission not found for this branch")
        
        return result
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting submission {submission_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{branch}/search-by-product")
async def search_by_product(
    branch: str,
    search: str = Query(..., description="SKU, item ID, or product name to search for"),
    limit: int = Query(50, ge=1, le=200),
    current_user: dict = Depends(get_current_user)
):
    """
    Search for all submissions containing a specific product
    
    This is useful for tracking the history of a specific item -
    finding all times it was scanned, added, or removed.
    """
    try:
        results = repo.get_submissions_by_product(
            search=search,
            branch=branch,
            limit=limit
        )
        return {
            'submissions': results,
            'total': len(results),
            'search': search
        }
        
    except Exception as e:
        logger.error(f"Error searching by product in {branch}: {e}")
        raise HTTPException(status_code=500, detail=str(e))
