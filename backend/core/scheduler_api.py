"""
API endpoints for manually triggering scheduler tasks.

Features:
- Background task execution (user can navigate away)
- Task state tracking (prevents duplicate runs)
- Real-time status updates via WebSocket
"""
from fastapi import APIRouter, Depends, HTTPException
from typing import Dict, Any, Optional
from datetime import datetime
from threading import Thread
import logging

from core.security import get_current_user
from core.websocket import emit_background

logger = logging.getLogger(__name__)

router = APIRouter()

# ============================================================
# Task State Tracking
# ============================================================
# Track which tasks are currently running
# Format: { task_id: { 'started_at': datetime, 'started_by': str, 'trigger': 'manual'|'scheduled' } }
_running_tasks: Dict[str, Dict[str, Any]] = {}

# Task metadata for display
TASK_METADATA = {
    'nightly-inventory-sync': {
        'name': 'Nightly Inventory Sync',
        'description': 'Sync Magento orders, catalog products, 6M data, and variant statuses',
    },
    'order-session-reset': {
        'name': 'Order Session Reset',
        'description': 'Reset all order sessions for re-approval',
    },
    'price-activation': {
        'name': 'Price Activation',
        'description': 'Activate prices scheduled for today',
    },
}


def is_task_running(task_id: str) -> bool:
    """Check if a task is currently running."""
    return task_id in _running_tasks


def get_running_task_info(task_id: str) -> Optional[Dict[str, Any]]:
    """Get info about a running task."""
    return _running_tasks.get(task_id)


def mark_task_started(task_id: str, started_by: str = 'system', trigger: str = 'scheduled'):
    """Mark a task as started and broadcast via WebSocket."""
    task_info = {
        'started_at': datetime.now().isoformat(),
        'started_by': started_by,
        'trigger': trigger,
    }
    _running_tasks[task_id] = task_info
    logger.info(f"📊 Task '{task_id}' marked as running (by {started_by}, trigger: {trigger})")
    
    # Broadcast to all connected clients
    emit_background('scheduler:task_started', {
        'task_id': task_id,
        **task_info
    })


def mark_task_completed(task_id: str):
    """Mark a task as completed and broadcast via WebSocket."""
    if task_id in _running_tasks:
        del _running_tasks[task_id]
        logger.info(f"✅ Task '{task_id}' marked as completed")
        
        # Broadcast to all connected clients
        emit_background('scheduler:task_completed', {
            'task_id': task_id,
            'completed_at': datetime.now().isoformat()
        })


def get_all_running_tasks() -> Dict[str, Dict[str, Any]]:
    """Get all currently running tasks."""
    return _running_tasks.copy()


# ============================================================
# Background Task Execution
# ============================================================

def _execute_task_in_background(task_id: str, task_func, started_by: str):
    """
    Execute a task function in a background thread.
    This allows the API to return immediately while the task runs.
    """
    def run_with_tracking():
        try:
            logger.info(f"🚀 Background task '{task_id}' starting execution...")
            task_func()
            logger.info(f"✅ Background task '{task_id}' completed successfully")
        except Exception as e:
            logger.error(f"❌ Background task '{task_id}' failed: {e}", exc_info=True)
        finally:
            mark_task_completed(task_id)
    
    # Mark as started before launching thread
    mark_task_started(task_id, started_by=started_by, trigger='manual')
    
    # Start background thread
    thread = Thread(target=run_with_tracking, daemon=True)
    thread.start()


# ============================================================
# API Endpoints
# ============================================================

@router.post("/run/{task_id}")
async def run_scheduler_task(
    task_id: str,
    current_user: dict = Depends(get_current_user)
) -> Dict[str, Any]:
    """
    Manually run a scheduled task in the background.
    
    The task will continue running even if the user navigates away.
    Returns immediately with a 'started' status.
    
    Available tasks:
    - nightly-inventory-sync: Run the nightly inventory metadata sync
    - order-session-reset: Reset all order sessions for re-approval
    - price-activation: Activate prices scheduled for today
    """
    from core.scheduler import (
        sync_inventory_metadata_nightly,
        reset_daily_order_sessions,
        activate_daily_prices,
    )
    
    # Map task IDs to functions
    task_handlers = {
        'nightly-inventory-sync': sync_inventory_metadata_nightly,
        'order-session-reset': reset_daily_order_sessions,
        'price-activation': activate_daily_prices,
    }
    
    if task_id not in task_handlers:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown task: {task_id}. Available tasks: {list(task_handlers.keys())}"
        )
    
    # Check if task is already running
    if is_task_running(task_id):
        running_info = get_running_task_info(task_id)
        raise HTTPException(
            status_code=409,  # Conflict
            detail={
                'error': 'task_already_running',
                'message': f"Task '{task_id}' is already running",
                'started_at': running_info.get('started_at'),
                'started_by': running_info.get('started_by'),
                'trigger': running_info.get('trigger'),
            }
        )
    
    username = current_user.get('username', 'unknown')
    logger.info(f"🔧 Manual task execution requested: {task_id} by user {username}")
    
    # Execute in background thread
    _execute_task_in_background(task_id, task_handlers[task_id], started_by=username)
    
    task_meta = TASK_METADATA.get(task_id, {})
    
    return {
        "success": True,
        "task": task_id,
        "status": "started",
        "message": f"Task '{task_meta.get('name', task_id)}' has been started in the background",
        "details": task_meta.get('description', ''),
    }


@router.get("/status")
async def get_scheduler_status(
    current_user: dict = Depends(get_current_user)
) -> Dict[str, Any]:
    """
    Get the current scheduler status, including:
    - Whether scheduler is enabled
    - Whether scheduler is running
    - Scheduled jobs and their next run times
    - Currently running tasks (manual or scheduled)
    """
    from core.scheduler import scheduler
    from core.config import settings
    
    jobs_info = []
    
    if scheduler.running:
        for job in scheduler.get_jobs():
            next_run = job.next_run_time
            jobs_info.append({
                "id": job.id,
                "name": job.name,
                "next_run": next_run.isoformat() if next_run else None,
            })
    
    # Get running tasks with metadata
    running_tasks = []
    for task_id, info in get_all_running_tasks().items():
        task_meta = TASK_METADATA.get(task_id, {})
        running_tasks.append({
            "task_id": task_id,
            "name": task_meta.get('name', task_id),
            "started_at": info.get('started_at'),
            "started_by": info.get('started_by'),
            "trigger": info.get('trigger'),
        })
    
    return {
        "enabled": settings.SCHEDULER_ENABLED,
        "running": scheduler.running,
        "jobs": jobs_info,
        "running_tasks": running_tasks,
    }


@router.get("/running")
async def get_running_tasks(
    current_user: dict = Depends(get_current_user)
) -> Dict[str, Any]:
    """
    Get only the currently running tasks.
    Useful for lightweight polling from the frontend.
    """
    running_tasks = []
    for task_id, info in get_all_running_tasks().items():
        task_meta = TASK_METADATA.get(task_id, {})
        running_tasks.append({
            "task_id": task_id,
            "name": task_meta.get('name', task_id),
            "started_at": info.get('started_at'),
            "started_by": info.get('started_by'),
            "trigger": info.get('trigger'),
        })
    
    return {
        "running_tasks": running_tasks,
    }
