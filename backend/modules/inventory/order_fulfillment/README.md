# Magento Invoice Pick & Pack System

This module provides invoice-based order fulfillment and returns processing using Magento's REST API.

## Features

- **Order Lookup**: Search by order number or invoice number
- **Pick & Pack Sessions**: Create dedicated scanning sessions for order fulfillment
- **Returns Processing**: Handle product returns with the same scanning interface
- **Real-time Validation**: Instant feedback on scanned products
- **Progress Tracking**: Visual progress indicators for session completion
- **Overpick Detection**: Warns when scanning more items than expected

## Setup

### Environment Variables

Add the following to your `.env` file:

```env
# Magento API Configuration
MAGENTO_BASE_URL=https://your-magento-store.com
MAGENTO_ACCESS_TOKEN=your_magento_api_token
```

### Magento API Token

1. Log into your Magento Admin Panel
2. Navigate to System > Extensions > Integrations
3. Create a new integration with the following permissions:
   - Sales > Invoices (Read)
   - Sales > Orders (Read)
4. Activate the integration and copy the Access Token

### Installing Dependencies

The Magento integration requires the `requests` library:

```bash
pip install requests
```

## Usage

### Starting a Session

1. Navigate to Inventory > Pick & Pack
2. Enter the order number
3. Select session type (Pick & Pack or Returns)
4. Click "Start Session"

### Scanning Products

1. Click in the SKU input field (or it will auto-focus)
2. Scan the product barcode or type the SKU manually
3. Adjust quantity if needed (default is 1)
4. Press Enter or click "Scan"

### Validation Feedback

- ✅ **Green**: Product scanned successfully
- ⚠️ **Orange**: Overpicked - scanned more than expected
- ❌ **Red**: Invalid SKU or product not on invoice

### Completing a Session

1. Scan all items until progress shows 100%
2. Click "Complete" to finalize the session
3. Session data is saved for record-keeping

## API Endpoints

### Start Session
```
POST /api/v1/magento/session/start
Body: {
  "order_number": "100000123",
  "session_type": "pick" | "return"
}
```

### Scan Product
```
POST /api/v1/magento/session/scan
Body: {
  "session_id": "uuid",
  "sku": "PROD-SKU-001",
  "quantity": 1
}
```

### Get Session Status
```
GET /api/v1/magento/session/status/{session_id}
```

### Complete Session
```
POST /api/v1/magento/session/complete
Body: {
  "session_id": "uuid",
  "force_complete": false
}
```

### Cancel Session
```
DELETE /api/v1/magento/session/{session_id}
```

## Data Storage

Session data is stored in:
```
backend/modules/magento/data/scan_sessions.json
```

This includes:
- Session metadata (order number, invoice, timestamps)
- Items expected vs scanned
- Session status (in_progress, completed, cancelled)

## Magento API Reference

This integration uses:
- `GET /rest/V1/invoices` - Search invoices
- `GET /rest/V1/invoices/{id}` - Get invoice details with line items

### Invoice Search Criteria

The system searches by:
- Order Increment ID (order number)
- Invoice Increment ID (invoice number)

## Troubleshooting

### "No invoice found for order number"
- Verify the order has been invoiced in Magento
- Check that the order number is correct
- Ensure your API token has invoice read permissions

### "Magento API error: 401 Unauthorized"
- Verify `MAGENTO_ACCESS_TOKEN` is set correctly
- Check token hasn't expired
- Ensure integration is activated in Magento

### "SKU not on this invoice"
- Verify the product SKU matches exactly
- Check for extra spaces or case differences
- Confirm the SKU was actually invoiced (not just ordered)

## Development

### Adding Custom Validations

Edit `backend/modules/magento/service.py` in the `scan_product` method to add custom business logic.

### Extending the UI

Frontend code is in:
- HTML: `frontend/html/inventory/magento.html`
- CSS: `frontend/css/inventory/magento.css`
- JS: `frontend/js/modules/magento-pickpack.js`

### Database Integration

To store sessions in a database instead of JSON:
1. Create a database model in `models.py`
2. Update `repo.py` to use database queries
3. Add migration scripts

## Future Enhancements

- [ ] Barcode scanner hardware integration
- [ ] Print packing slips after completion
- [ ] Email notifications on session completion
- [ ] Multi-user collaboration on same order
- [ ] Inventory sync back to Magento
- [ ] Session history and reporting
- [ ] Batch processing multiple orders
- [ ] Mobile-optimized interface

## Support

For issues or questions:
1. Check the troubleshooting section above
2. Review Magento API logs
3. Check browser console for JavaScript errors
4. Review backend logs for API errors
