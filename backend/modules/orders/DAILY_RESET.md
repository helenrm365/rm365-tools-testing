# Daily Order Reset System

## Overview

The daily order reset system automatically clears all order session data at midnight each day, allowing orders that are still in "processing" status on Magento to reappear in the pending orders approval list.

## How It Works

### Automatic Daily Reset

1. **Scheduled Task**: Runs automatically at **midnight (00:00)** every day
2. **Session Archival**: All current sessions are archived to a timestamped history file
3. **Data Cleared**: Active sessions, statuses, and takeover requests are reset
4. **Order Re-availability**: Orders still in "processing" status on Magento will reappear in the pending orders list

### What Gets Reset

- ✅ Approved orders
- ✅ In-progress sessions
- ✅ Completed sessions
- ✅ Draft sessions
- ✅ Cancelled sessions
- ✅ Ready-to-check sessions
- ✅ Takeover requests

### What Doesn't Get Affected

- ❌ **Magento order status** (remains unchanged - still "processing")
- ❌ **Historical data** (archived to history files for auditing)
- ❌ **Inventory data**
- ❌ **User data**

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Daily Reset Flow                          │
└─────────────────────────────────────────────────────────────┘

1. Midnight (00:00) - Scheduler triggers
   │
   ├─→ Archive all sessions to:
   │   backend/modules/orders/order_fulfillment/data/
   │   session_history_YYYYMMDD_HHMMSS.json
   │
   ├─→ Clear active sessions dictionary
   │
   ├─→ Clear takeover requests
   │
   └─→ Save empty state to scan_sessions.json

2. Next Day
   │
   └─→ Orders still "processing" on Magento
       reappear in pending orders list
```

## Implementation Details

### Key Files

1. **`backend/core/scheduler.py`**
   - APScheduler configuration
   - Daily reset job definition
   - Scheduler lifecycle management

2. **`backend/modules/orders/order_fulfillment/repo.py`**
   - `reset_daily_sessions()` method
   - Session archival logic
   - History file management

3. **`backend/app.py`**
   - Scheduler startup on app launch
   - Scheduler shutdown on app termination

4. **`backend/modules/orders/order_fulfillment/api.py`**
   - Manual reset endpoint for testing
   - Admin trigger for maintenance

### Data Persistence

- **Active Sessions**: `backend/modules/orders/order_fulfillment/data/scan_sessions.json`
- **History Archive**: `backend/modules/orders/order_fulfillment/data/session_history_YYYYMMDD_HHMMSS.json`
- **Takeover Requests**: `backend/modules/orders/order_fulfillment/data/takeover_requests.json`

## Usage

### Automatic Reset

No action needed - runs automatically at midnight daily.

### Manual Reset (Testing/Admin)

**Endpoint**: `POST /api/magento/admin/reset-sessions`

**Authentication**: Required

**Example Request**:
```bash
curl -X POST https://your-domain.com/api/magento/admin/reset-sessions \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**Example Response**:
```json
{
  "success": true,
  "message": "Order sessions reset successfully",
  "details": {
    "success": true,
    "total_sessions_reset": 15,
    "sessions_by_status": {
      "completed": 10,
      "in_progress": 3,
      "approved": 2
    },
    "archived_to": "/path/to/session_history_20241205_143022.json",
    "reset_at": "2024-12-05T14:30:22.123456"
  }
}
```

## Configuration

### Schedule Timing

To change the reset time, edit `backend/core/scheduler.py`:

```python
scheduler.add_job(
    reset_daily_order_sessions,
    trigger=CronTrigger(hour=0, minute=0),  # Midnight
    # Change to: trigger=CronTrigger(hour=3, minute=30)  # 3:30 AM
    id='daily_order_reset',
    name='Daily Order Session Reset',
    replace_existing=True
)
```

### Disable Auto-Reset

To disable automatic resets, comment out the scheduler initialization in `backend/app.py`:

```python
# --- Scheduler Initialization ------------------------------------------------
# try:
#     from core.scheduler import start_scheduler, shutdown_scheduler
#     ...
# except Exception as e:
#     ...
```

## Benefits

1. **Fresh Start Daily**: Each day begins with a clean slate for order processing
2. **No Manual Cleanup**: Automatic archival keeps the system organized
3. **Magento Sync**: Orders still pending in Magento stay visible for processing
4. **Audit Trail**: All session data is preserved in history files
5. **Flexibility**: Manual trigger available for testing and maintenance

## Monitoring

Check scheduler status in application logs:

```
📅 Scheduler configured:
  - Daily order reset: 00:00 (midnight)
✅ Background scheduler started successfully
```

Check reset execution:

```
🔄 Starting daily order session reset...
✅ Archived 15 sessions to .../session_history_20241205_000000.json
✅ Daily reset completed - cleared 15 sessions
```

## Troubleshooting

### Reset Not Running

1. Check if APScheduler is installed:
   ```bash
   pip install apscheduler
   ```

2. Verify scheduler started in logs:
   ```
   ✅ Background scheduler configured
   ```

3. Check for scheduler errors in application logs

### Manual Reset Failed

- Verify authentication token is valid
- Check user permissions (admin may be required)
- Review error details in response

### Sessions Not Clearing

- Check file permissions on `data/` directory
- Verify no file locks on `scan_sessions.json`
- Review application logs for errors

## See Also

- Order Fulfillment Documentation
- Order Tracking System
- Magento Integration Guide
