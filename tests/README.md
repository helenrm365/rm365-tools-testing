# Tests Directory

This directory contains all test, debug, and validation scripts organized by module/feature area.

## Directory Structure

```
tests/
├── attendance/           # Attendance module tests
│   ├── test_automatic_nfc.py
│   └── test_locations_api.py
├── frontend/             # Frontend/UI tests
│   ├── console_test_mobile_mode.js
│   ├── quick_mobile_test.html
│   ├── test_mobile_mode_autotoggle.html
│   ├── run_mobile_mode_test.sh
│   └── MOBILE_MODE_TEST_REPORT.md
├── hardware_bridge/      # Hardware bridge tests
│   ├── test_nfc.py
│   └── test_readers.py
├── inventory/            # Inventory module tests
│   ├── test_data_integrity.py
│   ├── test_inventory_performance.py
│   ├── test_sourcing_integration.py
│   └── management/       # Inventory management utilities
│       ├── check_variant_statuses.py
│       ├── debug_import_inventory.py
│       ├── debug_sku.py
│       └── find_orphaned_skus.py
├── labels/               # Labels module tests
│   ├── test_labels_performance.py
│   └── test_labels_status.py
├── magentodata/          # Magento data tests & utilities
│   ├── analyze_magento_indexes.py
│   ├── apply_magento_indexes.py
│   ├── check_discontinued_status.py
│   ├── compare_magento_vs_cache.py
│   ├── debug_db_names.py
│   ├── diagnose_magento_performance.py
│   ├── test_customer_exclusion_rules.py
│   ├── test_magento_connections.py
│   ├── test_magento_page_load_times.py
│   ├── test_optimized_magento_query.py
│   ├── test_refresh_performance.py
│   └── test_sync_flow.py
├── orders/               # Order fulfillment tests
│   ├── test_extreme_workflow.py   # Main comprehensive test
│   └── test_orders_structure.py
└── usermanagement/       # User management tests
    └── test_usermanagement_structure.py
```

## Key Tests

### Order Fulfillment (Primary)
```bash
python3 tests/orders/test_extreme_workflow.py
```
This is the comprehensive test covering the entire order fulfillment workflow:
- Session lifecycle (create, scan, draft, cancel, complete)
- Inventory tracking and returns
- Ready to check workflow
- Send back for picking with counted quantities
- Daily reset/scheduler
- Multi-source inventory

### Hardware Bridge
```bash
python3 tests/hardware_bridge/test_nfc.py
python3 tests/hardware_bridge/test_readers.py
```

### Magento Data
```bash
python3 tests/magentodata/test_magento_connections.py
python3 tests/magentodata/test_magento_page_load_times.py
```

## Test Categories

| Folder | Purpose |
|--------|---------|
| `attendance/` | NFC attendance and location tests |
| `frontend/` | Mobile mode and UI tests |
| `hardware_bridge/` | NFC reader and hardware integration |
| `inventory/` | Inventory data integrity and sourcing |
| `labels/` | Label generation and printing |
| `magentodata/` | Magento database and sync tests |
| `orders/` | Order fulfillment workflow tests |
| `usermanagement/` | User management structure tests |
