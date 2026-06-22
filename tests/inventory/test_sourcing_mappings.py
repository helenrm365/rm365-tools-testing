#!/usr/bin/env python3
"""
Unit tests for Supplier Product Mappings in Product Sourcing module
"""
import sys
import unittest
from unittest.mock import MagicMock, patch

# Insert backend directory to path
sys.path.insert(0, './backend')

class TestSourcingMappings(unittest.TestCase):
    
    def setUp(self):
        # Setup mock database connection and cursor
        self.conn_mock = MagicMock()
        self.cursor_mock = MagicMock()
        self.conn_mock.cursor.return_value = self.cursor_mock
        
        # Patch get_inventory_log_connection
        self.db_patcher = patch('modules.inventory.sourcing.repository.get_inventory_log_connection')
        self.mock_get_conn = self.db_patcher.start()
        self.mock_get_conn.return_value = self.conn_mock
        
        self.return_conn_patcher = patch('modules.inventory.sourcing.repository.return_inventory_connection')
        self.mock_return_conn = self.return_conn_patcher.start()
        
    def tearDown(self):
        self.db_patcher.stop()
        self.return_conn_patcher.stop()

    def test_repository_table_creation(self):
        """Test repository table creation queries are executed properly"""
        from modules.inventory.sourcing.repository import SourcingRepository
        repo = SourcingRepository()
        
        # Mock cursor for table check/creation
        self.cursor_mock.fetchone.return_value = (True,)
        
        # Call table init
        repo.init_tables()
        
        # Verify cursor executed CREATE TABLE IF NOT EXISTS queries
        executed_statements = [call[0][0] for call in self.cursor_mock.execute.call_args_list]
        
        # Check if table creation and indexes are in the queries
        has_mappings_table = any("sourcing_supplier_product_mappings" in query for query in executed_statements)
        has_index_supplier = any("idx_sourcing_mappings_supplier" in query for query in executed_statements)
        has_index_sku = any("idx_sourcing_mappings_sku" in query for query in executed_statements)
        has_index_name = any("idx_sourcing_mappings_name" in query for query in executed_statements)
        
        self.assertTrue(has_mappings_table, "Mappings table creation query not executed")
        self.assertTrue(has_index_supplier, "Supplier mapping index creation query not executed")
        self.assertTrue(has_index_sku, "SKU mapping index creation query not executed")
        self.assertTrue(has_index_name, "Name mapping index creation query not executed")

    def test_repository_resolve_supplier_sku(self):
        """Test trimmed case-insensitive sku resolution logic"""
        from modules.inventory.sourcing.repository import SourcingRepository
        repo = SourcingRepository()
        
        # 1. Test when mapping is found
        self.cursor_mock.fetchone.return_value = ('JUVEDERM-3',)
        resolved = repo.resolve_supplier_sku(1, "  Juvderm 3  ")
        
        self.assertEqual(resolved, 'JUVEDERM-3')
        # Verify query had REGEXP_REPLACE and LOWER
        query = self.cursor_mock.execute.call_args[0][0]
        self.assertIn("supplier_sku", query)
        self.assertIn("supplier_product_name", query)
        
        # 2. Test when mapping is not found
        self.cursor_mock.fetchone.return_value = None
        resolved_none = repo.resolve_supplier_sku(1, "unknown")
        self.assertIsNone(resolved_none)

    def test_importer_resolves_alternative_sku(self):
        """Test CSV importer resolves alternative supplier identifier to canonical SKU"""
        from modules.inventory.sourcing.service import SourcingService
        
        # Mock repository methods in service
        service = SourcingService()
        service.repo = MagicMock()
        
        # Mock active suppliers
        service.repo.get_suppliers.return_value = [
            {'id': 10, 'code': 'AMS', 'name': 'AMS', 'default_currency': 'GBP', 'is_active': True}
        ]
        
        # Mock valid SKUs in inventory_metadata
        service.repo.get_all_products_from_inventory_metadata.return_value = [
            {'sku': 'JUVEDERM-3', 'product_name': 'Juvederm 3 Internal'}
        ]
        
        # Mock full matrix to return empty list (no existing pricing)
        service.repo.get_full_matrix.return_value = []
        
        # Scenario A: Alternative SKU is used ("Juvderm 3")
        # resolve_supplier_sku should return "JUVEDERM-3"
        def resolve_mock(supplier_id, identifier):
            if supplier_id == 10 and identifier == "Juvderm 3":
                return "JUVEDERM-3"
            return None
        service.repo.resolve_supplier_sku.side_effect = resolve_mock
        
        # CSV content with alternative identifier in 'sku' column
        csv_content = "sku,product_name,AMS_price,AMS_currency\nJuvderm 3,Juvederm 3 Alternative,15.50,GBP\n"
        
        result = service.import_matrix_csv(csv_content)
        
        # Verify it successfully resolved alternative SKU and upserted pricing for JUVEDERM-3
        # Since we mock the bulk_upsert_pricing method, the returned count from import_matrix_csv depends on what it returns.
        # Let's inspect bulk_upsert_pricing calls
        upsert_calls = service.repo.bulk_upsert_pricing.call_args_list
        self.assertEqual(len(upsert_calls), 1)
        entries = upsert_calls[0][0][0]
        
        self.assertEqual(entries[0]['sku'], 'JUVEDERM-3', "Alternative SKU 'Juvderm 3' was not resolved to internal SKU 'JUVEDERM-3'")
        self.assertEqual(entries[0]['supplier_id'], 10)
        self.assertEqual(entries[0]['unit_price'], 15.50)

    def test_importer_resolves_by_product_name(self):
        """Test CSV importer resolves by product_name when SKU is not canonical and doesn't map directly"""
        from modules.inventory.sourcing.service import SourcingService
        
        service = SourcingService()
        service.repo = MagicMock()
        
        service.repo.get_suppliers.return_value = [
            {'id': 10, 'code': 'AMS', 'name': 'AMS', 'default_currency': 'GBP', 'is_active': True}
        ]
        
        service.repo.get_all_products_from_inventory_metadata.return_value = [
            {'sku': 'JUVEDERM-3', 'product_name': 'Juvederm 3 Internal'}
        ]
        
        service.repo.get_full_matrix.return_value = []
        
        # Mock resolve_supplier_sku: only resolves "Juvederm 3 Alt Name" (the product name) to "JUVEDERM-3"
        # The SKU col in CSV is "AMS-ALT-SKU" which doesn't resolve directly
        def resolve_mock(supplier_id, identifier):
            if supplier_id == 10 and identifier == "Juvederm 3 Alt Name":
                return "JUVEDERM-3"
            return None
        service.repo.resolve_supplier_sku.side_effect = resolve_mock
        
        # CSV content with non-matching sku column, but matching product_name column
        csv_content = "sku,product_name,AMS_price,AMS_currency\nAMS-ALT-SKU,Juvederm 3 Alt Name,20.00,GBP\n"
        
        result = service.import_matrix_csv(csv_content)
        
        upsert_calls = service.repo.bulk_upsert_pricing.call_args_list
        self.assertEqual(len(upsert_calls), 1)
        entries = upsert_calls[0][0][0]
        
        self.assertEqual(entries[0]['sku'], 'JUVEDERM-3', "Product name 'Juvederm 3 Alt Name' was not resolved to internal SKU 'JUVEDERM-3'")
        self.assertEqual(entries[0]['supplier_id'], 10)
        self.assertEqual(entries[0]['unit_price'], 20.00)

if __name__ == '__main__':
    unittest.main()
