# Tests Directory

This directory contains all test, debug, and validation scripts organized by module/feature area.

## Directory Structure

```
tests/
├── inventory/
│   ├── sourcing/          # Product Sourcing tests
│   │   ├── test_sourcing_features.py
│   │   ├── test_temporal_pricing.py
│   │   ├── test_all_features.py
│   │   └── test_frontend_code.py
│   └── management/        # Inventory Management tests
│       ├── debug_import_inventory.py
│       ├── check_variant_statuses.py
│       ├── debug_sku.py
│       └── find_orphaned_skus.py
├── backend/               # Backend integration tests
│   ├── test_frontend_integration.py
│   ├── test_frontend_validation.py
│   └── debug_import.py
├── magentodata/          # Magento data tests
│   ├── check_discontinued_status.py
│   └── debug_db_names.py
└── hardware_bridge/      # Hardware bridge tests
    ├── test_nfc.py
    └── test_readers.py
```

## Running Tests

### Inventory Sourcing Tests
```bash
cd /Users/ianhjweng/Documents/github/rm365-tools-testing
.venv/bin/python tests/inventory/sourcing/test_sourcing_features.py
.venv/bin/python tests/inventory/sourcing/test_temporal_pricing.py
```

### Backend Integration Tests
```bash
cd /Users/ianhjweng/Documents/github/rm365-tools-testing
.venv/bin/python tests/backend/test_frontend_integration.py
.venv/bin/python tests/backend/test_frontend_validation.py
```

### Hardware Bridge Tests
```bash
cd /Users/ianhjweng/Documents/github/rm365-tools-testing
.venv/bin/python tests/hardware_bridge/test_nfc.py
.venv/bin/python tests/hardware_bridge/test_readers.py
```

## Test Categories

- **Sourcing Tests**: Test temporal pricing, supplier selection, and product sourcing features
- **Management Tests**: Test inventory import, variant status, and SKU management
- **Backend Tests**: Integration tests for frontend-backend communication
- **Magento Tests**: Tests for Magento database queries and data synchronization
- **Hardware Tests**: Tests for NFC readers and local hardware integration
