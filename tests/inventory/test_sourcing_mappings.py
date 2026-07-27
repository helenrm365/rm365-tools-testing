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
        has_index_identifier = any("idx_sourcing_mappings_identifier" in query for query in executed_statements)
        
        self.assertTrue(has_mappings_table, "Mappings table creation query not executed")
        self.assertTrue(has_index_supplier, "Supplier mapping index creation query not executed")
        self.assertTrue(has_index_identifier, "Identifier mapping index creation query not executed")

    def test_repository_resolve_supplier_sku(self):
        """Test trimmed case-insensitive sku resolution logic"""
        from modules.inventory.sourcing.repository import SourcingRepository
        repo = SourcingRepository()
        
        # 1. Test when mapping is found
        self.cursor_mock.fetchone.return_value = ('JUVEDERM-3',)
        resolved = repo.resolve_supplier_sku(1, "  Juvderm 3  ")
        
        self.assertEqual(resolved, 'JUVEDERM-3')
        # Verify query had TRIM and LOWER
        query = self.cursor_mock.execute.call_args[0][0]
        self.assertIn("TRIM(LOWER(supplier_identifier)) = TRIM(LOWER(%s))", query)
        
        # 2. Test when mapping is not found
        self.cursor_mock.fetchone.return_value = None
        resolved_none = repo.resolve_supplier_sku(1, "unknown")
        self.assertIsNone(resolved_none)

    def _make_gsheet_service(self, records):
        """Build a SourcingService with mocked repo/sheet access for import tests."""
        from modules.inventory.sourcing.service import SourcingService

        service = SourcingService()
        service.repo = MagicMock()
        service.gsheets = MagicMock()
        service.gsheets.import_matrix_from_sheet.return_value = records

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

        return service

    def test_importer_resolves_alternative_sku(self):
        """Test importer resolves alternative supplier identifier to canonical SKU"""
        # Alternative SKU is used ("Juvderm 3") — resolve_supplier_sku returns "JUVEDERM-3"
        service = self._make_gsheet_service([
            {'sku': 'Juvderm 3', 'product_name': 'Juvederm 3 Alternative',
             'AMS_price': '15.50', 'AMS_currency': 'GBP'}
        ])

        def resolve_mock(supplier_id, identifier):
            if supplier_id == 10 and identifier == "Juvderm 3":
                return "JUVEDERM-3"
            return None
        service.repo.resolve_supplier_sku.side_effect = resolve_mock

        service.sync_matrix_from_gsheet('sheet-id')

        # Verify it successfully resolved alternative SKU and upserted pricing for JUVEDERM-3
        upsert_calls = service.repo.bulk_upsert_pricing.call_args_list
        self.assertEqual(len(upsert_calls), 1)
        entries = upsert_calls[0][0][0]

        self.assertEqual(entries[0]['sku'], 'JUVEDERM-3', "Alternative SKU 'Juvderm 3' was not resolved to internal SKU 'JUVEDERM-3'")
        self.assertEqual(entries[0]['supplier_id'], 10)
        self.assertEqual(entries[0]['unit_price'], 15.50)

    def test_importer_resolves_by_product_name(self):
        """Test importer resolves by product_name when SKU is not canonical and doesn't map directly"""
        # The sku column is "AMS-ALT-SKU" which doesn't resolve directly, but the
        # product_name does.
        service = self._make_gsheet_service([
            {'sku': 'AMS-ALT-SKU', 'product_name': 'Juvederm 3 Alt Name',
             'AMS_price': '20.00', 'AMS_currency': 'GBP'}
        ])

        def resolve_mock(supplier_id, identifier):
            if supplier_id == 10 and identifier == "Juvederm 3 Alt Name":
                return "JUVEDERM-3"
            return None
        service.repo.resolve_supplier_sku.side_effect = resolve_mock

        service.sync_matrix_from_gsheet('sheet-id')

        upsert_calls = service.repo.bulk_upsert_pricing.call_args_list
        self.assertEqual(len(upsert_calls), 1)
        entries = upsert_calls[0][0][0]

        self.assertEqual(entries[0]['sku'], 'JUVEDERM-3', "Product name 'Juvederm 3 Alt Name' was not resolved to internal SKU 'JUVEDERM-3'")
        self.assertEqual(entries[0]['supplier_id'], 10)
        self.assertEqual(entries[0]['unit_price'], 20.00)

if __name__ == '__main__':
    unittest.main()
