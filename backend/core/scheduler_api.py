"""
API endpoints for manually triggering scheduler tasks.

Features:
- Background task execution with SSE progress streaming
- Task state tracking (prevents duplicate runs)
- Real-time status updates via WebSocket
"""
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from typing import Dict, Any, Optional
from datetime import datetime
from threading import Thread
import threading
import queue
import json
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
    'sync-uk-orders': {
        'name': 'UK Order Sync',
        'description': 'Sync UK Magento orders (7-day lookback)',
    },
    'sync-fr-orders': {
        'name': 'FR Order Sync',
        'description': 'Sync FR Magento orders (7-day lookback)',
    },
    'sync-nl-orders': {
        'name': 'NL Order Sync',
        'description': 'Sync NL Magento orders (7-day lookback)',
    },
    'sync-catalog': {
        'name': 'Catalog Sync',
        'description': 'Sync Magento catalog products, merge identifiers, update variant statuses',
    },
    'sync-6m-data': {
        'name': '6M Sales Data Sync',
        'description': 'Update 6-month rolling sales data in inventory_metadata',
    },
    'sync-branch-inventory': {
        'name': 'Branch Inventory Sync',
        'description': 'Sync new products from master catalog to branch warehouse inventories',
    },
    'backfill-shipping-methods': {
        'name': 'Populate Shipping Methods',
        'description': 'Backfill shipping method data for cached orders from Magento',
    },
}

# ── Conflict Groups ──
# Tasks in the same conflict group cannot run concurrently.
# 'nightly-inventory-sync' conflicts with all its sub-tasks (and vice versa).
CONFLICT_GROUPS = {
    # Nightly sync conflicts with all sub-tasks (it runs them all)
    'nightly-vs-uk':      ['nightly-inventory-sync', 'sync-uk-orders'],
    'nightly-vs-fr':      ['nightly-inventory-sync', 'sync-fr-orders'],
    'nightly-vs-nl':      ['nightly-inventory-sync', 'sync-nl-orders'],
    'nightly-vs-catalog': ['nightly-inventory-sync', 'sync-catalog'],
    'nightly-vs-6m':      ['nightly-inventory-sync', 'sync-6m-data'],
    'nightly-vs-branch':  ['nightly-inventory-sync', 'sync-branch-inventory'],
    # 6M reads from aggregated orders — can't run while orders are refreshing
    'uk-orders-vs-6m':    ['sync-uk-orders', 'sync-6m-data'],
    'fr-orders-vs-6m':    ['sync-fr-orders', 'sync-6m-data'],
    'nl-orders-vs-6m':    ['sync-nl-orders', 'sync-6m-data'],
    # 6M and catalog both write to inventory_metadata
    '6m-vs-catalog':      ['sync-6m-data', 'sync-catalog'],
    # 6M writes to inventory_metadata while branch reads from it
    '6m-vs-branch':       ['sync-6m-data', 'sync-branch-inventory'],
    # Branch reads inventory_metadata that catalog actively modifies
    'catalog-vs-branch':  ['sync-catalog', 'sync-branch-inventory'],
}


def get_conflicting_task(task_id: str) -> Optional[str]:
    """
    Check if any task in the same conflict group is currently running.
    Returns the conflicting task_id if found, else None.
    """
    for group_tasks in CONFLICT_GROUPS.values():
        if task_id in group_tasks:
            for other_id in group_tasks:
                if other_id != task_id and is_task_running(other_id):
                    return other_id
    return None


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
    Manually run a scheduled task in the background (fire-and-forget).
    Use /run/{task_id}/stream for SSE progress updates.
    """
    from core.scheduler import (
        sync_inventory_metadata_nightly,
        sync_region_orders_task,
        sync_catalog_task,
        sync_6m_data_task,
        sync_branch_inventory_task,
    )
    
    task_handlers = {
        'nightly-inventory-sync': sync_inventory_metadata_nightly,
        'sync-uk-orders': lambda **kw: sync_region_orders_task('uk', **kw),
        'sync-fr-orders': lambda **kw: sync_region_orders_task('fr', **kw),
        'sync-nl-orders': lambda **kw: sync_region_orders_task('nl', **kw),
        'sync-catalog': sync_catalog_task,
        'sync-6m-data': sync_6m_data_task,
        'sync-branch-inventory': sync_branch_inventory_task,
    }
    
    if task_id not in task_handlers:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown task: {task_id}. Available tasks: {list(task_handlers.keys())}"
        )
    
    if is_task_running(task_id):
        running_info = get_running_task_info(task_id)
        raise HTTPException(
            status_code=409,
            detail={
                'error': 'task_already_running',
                'message': f"Task '{task_id}' is already running",
                'started_at': running_info.get('started_at'),
                'started_by': running_info.get('started_by'),
                'trigger': running_info.get('trigger'),
            }
        )
    
    conflicting = get_conflicting_task(task_id)
    if conflicting:
        conflict_meta = TASK_METADATA.get(conflicting, {})
        raise HTTPException(
            status_code=409,
            detail={
                'error': 'conflicting_task_running',
                'message': f"Cannot run while '{conflict_meta.get('name', conflicting)}' is active",
                'conflicting_task': conflicting,
            }
        )
    
    username = current_user.get('username', 'unknown')
    logger.info(f"🔧 Manual task execution requested: {task_id} by user {username}")
    
    _execute_task_in_background(task_id, task_handlers[task_id], started_by=username)
    
    task_meta = TASK_METADATA.get(task_id, {})
    
    return {
        "success": True,
        "task": task_id,
        "status": "started",
        "message": f"Task '{task_meta.get('name', task_id)}' has been started in the background",
        "details": task_meta.get('description', ''),
    }


@router.post("/run/{task_id}/stream")
def run_scheduler_task_stream(
    task_id: str,
    current_user: dict = Depends(get_current_user)
):
    """
    Manually run a scheduled task with SSE progress streaming.
    Returns a text/event-stream with progress updates.
    """
    from core.scheduler import (
        sync_inventory_metadata_nightly,
        sync_region_orders_task,
        sync_catalog_task,
        sync_6m_data_task,
        sync_branch_inventory_task,
    )
    
    task_handlers = {
        'nightly-inventory-sync': sync_inventory_metadata_nightly,
        'sync-uk-orders': lambda **kw: sync_region_orders_task('uk', **kw),
        'sync-fr-orders': lambda **kw: sync_region_orders_task('fr', **kw),
        'sync-nl-orders': lambda **kw: sync_region_orders_task('nl', **kw),
        'sync-catalog': sync_catalog_task,
        'sync-6m-data': sync_6m_data_task,
        'sync-branch-inventory': sync_branch_inventory_task,
    }
    
    if task_id not in task_handlers:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown task: {task_id}. Available tasks: {list(task_handlers.keys())}"
        )
    
    if is_task_running(task_id):
        running_info = get_running_task_info(task_id)
        raise HTTPException(
            status_code=409,
            detail={
                'error': 'task_already_running',
                'message': f"Task '{task_id}' is already running",
                'started_at': running_info.get('started_at'),
                'started_by': running_info.get('started_by'),
                'trigger': running_info.get('trigger'),
            }
        )
    
    conflicting = get_conflicting_task(task_id)
    if conflicting:
        conflict_meta = TASK_METADATA.get(conflicting, {})
        raise HTTPException(
            status_code=409,
            detail={
                'error': 'conflicting_task_running',
                'message': f"Cannot run while '{conflict_meta.get('name', conflicting)}' is active",
                'conflicting_task': conflicting,
            }
        )
    
    username = current_user.get('username', 'unknown')
    logger.info(f"🔧 Manual task execution (streamed) requested: {task_id} by user {username}")
    
    progress_queue = queue.Queue()
    result_holder = [None]
    
    def progress_callback(percent, message):
        progress_queue.put({"type": "progress", "percent": percent, "message": message})
    
    def run_task():
        mark_task_started(task_id, started_by=username, trigger='manual')
        try:
            task_handlers[task_id](progress_callback=progress_callback)
            result_holder[0] = {"status": "success"}
        except Exception as e:
            logger.error(f"❌ Task '{task_id}' failed: {e}", exc_info=True)
            result_holder[0] = {"status": "error", "message": str(e)}
        finally:
            mark_task_completed(task_id)
            progress_queue.put({"type": "done"})
    
    worker = Thread(target=run_task, daemon=True)
    worker.start()
    
    def event_stream():
        while True:
            try:
                event = progress_queue.get(timeout=300)
                if event["type"] == "done":
                    result = result_holder[0] or {"status": "error", "message": "No result"}
                    yield f"data: {json.dumps({'type': 'complete', **result})}\n\n"
                    break
                yield f"data: {json.dumps(event)}\n\n"
            except queue.Empty:
                yield f"data: {json.dumps({'type': 'progress', 'percent': -1, 'message': 'Still processing...'})}\n\n"
    
    return StreamingResponse(event_stream(), media_type="text/event-stream")


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
    Get only the currently running tasks + which tasks are blocked by conflicts.
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
    
    # Build blocked_tasks: task_ids that can't run due to conflict
    blocked_tasks = {}
    for meta_task_id in TASK_METADATA:
        if is_task_running(meta_task_id):
            continue
        conflicting = get_conflicting_task(meta_task_id)
        if conflicting:
            blocked_tasks[meta_task_id] = {
                'blocked_by': conflicting,
                'blocked_by_name': TASK_METADATA.get(conflicting, {}).get('name', conflicting),
            }
    
    return {
        "running_tasks": running_tasks,
        "blocked_tasks": blocked_tasks,
    }
