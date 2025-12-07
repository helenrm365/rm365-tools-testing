# Installation Instructions for Daily Order Reset

## Step 1: Install Dependencies

The daily order reset system requires the `apscheduler` package. Install it using:

```bash
cd backend
pip install -r requirements.txt
```

Or install just the scheduler:

```bash
pip install apscheduler
```

## Step 2: Verify Installation

After starting the backend server, you should see these messages in the logs:

```
📅 Scheduler configured:
  - Daily order reset: 00:00 (midnight)
✅ Background scheduler started successfully
✅ Background scheduler configured
```

If you see this instead:
```
⚠️  Scheduler initialization failed: ...
⚠️  Daily order resets will not run automatically
```

Then the scheduler failed to start. Check the error message for details.

## Step 3: Test the Reset (Optional)

You can manually trigger a reset to verify it's working:

### Using curl:

```bash
curl -X POST http://localhost:8000/api/magento/admin/reset-sessions \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json"
```

### Using the frontend:

Navigate to the Orders module and look for an admin option to reset sessions (if UI is built).

### Expected Response:

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

## Step 4: Verify Order Re-appearance

1. Before reset: Note which orders are in the "Pending Orders" list
2. Create some test sessions (approve/start processing some orders)
3. Trigger a manual reset
4. Check the "Pending Orders" list again
5. Orders that are still "processing" in Magento should reappear

## Troubleshooting

### Module Not Found Error

If you get `ModuleNotFoundError: No module named 'apscheduler'`:

```bash
pip install apscheduler
```

### Scheduler Not Starting

Check the application logs for errors. Common issues:
- Missing dependencies
- File permission issues in `data/` directory
- Python version compatibility (requires Python 3.7+)

### Reset Not Running at Midnight

- Verify the server is running continuously
- Check system time zone settings
- Review scheduler logs for job execution

## File Locations

After reset, check these locations:

- **Active Sessions**: `backend/modules/orders/order_fulfillment/data/scan_sessions.json` (should be empty or `{}`)
- **History Files**: `backend/modules/orders/order_fulfillment/data/session_history_*.json`
- **Logs**: Check application console/log files for reset messages

## Next Steps

1. Monitor the first automatic reset at midnight
2. Verify orders reappear correctly in pending list
3. Check that history files are being created properly
4. Adjust schedule timing if needed (see DAILY_RESET.md)

For more details, see `DAILY_RESET.md` in this directory.
