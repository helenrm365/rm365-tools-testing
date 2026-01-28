# Tests Directory

This directory contains all test, debug, and validation scripts organized by module/feature area.

## Directory Structure

```
tests/
├── inventory/
│   └── management/        # Inventory Management tests
│       ├── debug_import_inventory.py
│       ├── check_variant_statuses.py
│       ├── debug_sku.py
│       └── find_orphaned_skus.py
├── backend/               # Backend integration tests
│   └── debug_import.py
├── magentodata/          # Magento data tests
│   ├── check_discontinued_status.py
│   └── debug_db_names.py
└── hardware_bridge/      # Hardware bridge tests
    ├── test_nfc.py
    └── test_readers.py
```

## Running Tests

### Hardware Bridge Tests
```bash
cd /Users/ianhjweng/Documents/github/rm365-tools-testing
.venv/bin/python tests/hardware_bridge/test_nfc.py
.venv/bin/python tests/hardware_bridge/test_readers.py
```

## Test Categories

- **Management Tests**: Test inventory import, variant status, and SKU management
- **Magento Tests**: Tests for Magento database queries and data synchronization
- **Hardware Tests**: Tests for NFC readers and local hardware integration
