from typing import Dict, Any
import logging
from .repo import MagentoDataRepo
from .client import MagentoDataClient

logger = logging.getLogger(__name__)


class MagentoDataService:
    """Service layer for magento data operations"""
    
    def __init__(self, repo: MagentoDataRepo = None):
        self.repo = repo or MagentoDataRepo()
    
    # Table name mapping for validation
    VALID_REGIONS = {
        'uk': 'uk_magento_data',
        'fr': 'fr_magento_data',
        'nl': 'nl_magento_data'
    }
    
    def _get_table_name(self, region: str) -> str:
        """Get the table name for a region, validating it's a known region"""
        table_name = self.VALID_REGIONS.get(region.lower())
        if not table_name:
            raise ValueError(f"Invalid region: {region}. Must be one of: {', '.join(self.VALID_REGIONS.keys())}")
        return table_name
    
    def initialize_tables(self) -> Dict[str, Any]:
        """
        Initialize the magento data tables.
        Creates uk_magento_data, fr_magento_data, nl_magento_data and their condensed versions.
        Also populates condensed tables with existing data and auto-creates MD variant aliases.
        """
        try:
            tables = self.repo.init_tables()
            
            # Auto-create MD variant aliases if there's existing data
            try:
                alias_result = self.repo.auto_create_md_variant_aliases()
                logger.info(f"Auto-created {alias_result.get('aliases_created', 0)} MD variant aliases")
            except Exception as e:
                logger.warning(f"Could not auto-create MD variant aliases: {e}")
            
            # Refresh condensed data for all regions
            for region in ['uk', 'fr', 'nl']:
                try:
                    self.repo.refresh_condensed_data(region)
                except Exception as e:
                    logger.warning(f"Could not refresh condensed data for {region}: {e}")
            
            return {
                "status": "success",
                "message": "Magento data tables initialized successfully",
                "tables": tables
            }
        except Exception as e:
            logger.error(f"Error initializing tables: {e}")
            return {
                "status": "error",
                "message": f"Failed to initialize tables: {str(e)}",
                "tables": []
            }
    
    def check_tables_status(self) -> Dict[str, Any]:
        """Check the status of magento data tables"""
        try:
            status = self.repo.check_tables_exist()
            all_exist = all(status.values())
            
            return {
                "status": "success",
                "tables_status": status,
                "all_tables_exist": all_exist
            }
        except Exception as e:
            logger.error(f"Error checking tables: {e}")
            return {
                "status": "error",
                "message": f"Failed to check tables: {str(e)}"
            }
    
    def test_sync_magento_data(
        self,
        max_orders: int = 10,
        username: str = None,
        progress_callback: callable = None
    ) -> Dict[str, Any]:
        """
        Test sync: Sync a small number of orders to test_magento_data table.
        Now uses metadata tracking for resumable syncs.
        
        Args:
            max_orders: Number of orders to sync (default 10)
            username: User performing the sync
            progress_callback: Optional callback for progress updates
        
        Returns:
            Dict with status, message, and sync statistics
        """
        try:
            # Initialize test table if it doesn't exist
            self.repo.init_test_table()
            
            # Get last sync metadata for resumable test syncs
            start_date = None
            metadata = self.repo.get_sync_metadata('test')
            if metadata and metadata.get('last_synced_order_date'):
                # Convert timestamp to string format for Magento API
                last_date = metadata['last_synced_order_date']
                start_date = last_date.strftime('%Y-%m-%d %H:%M:%S')
                logger.info(f"Resuming test sync from last synced order: {start_date}")
                if progress_callback:
                    progress_callback(f"Resuming test from {start_date}...")
            
            # Verify last order was completely saved before continuing
            if start_date:
                completeness_check = self.repo.verify_order_completeness('test_magento_data', start_date, region='test')
                if not completeness_check['is_complete']:
                    logger.warning(f"Last order incomplete: {completeness_check['message']}")
                    # Re-sync the incomplete order by using the date before it
                    if completeness_check.get('suggested_start_date'):
                        start_date = completeness_check['suggested_start_date']
                        logger.info(f"Re-syncing from {start_date} to complete partial order")
            
            # Initialize Magento client (uses UK credentials)
            logger.info(f"Initializing Magento client for test sync")
            client = MagentoDataClient(region="uk")
            
            # Fetch product-level rows from Magento
            logger.info(f"Fetching {max_orders} orders from Magento for test")
            product_rows = client.fetch_orders_product_breakdown(
                start_date=start_date,
                max_orders=max_orders,
                progress_callback=progress_callback
            )
            
            if not product_rows:
                return {
                    "status": "success",
                    "message": "No new data to sync from Magento",
                    "rows_synced": 0,
                    "orders_processed": 0
                }
            
            # Count unique orders
            unique_orders = len(set(row['order_number'] for row in product_rows))
            
            # Find the most recent order date for metadata tracking
            # Filter out any rows without created_at to avoid errors
            order_dates = [row['created_at'] for row in product_rows if row.get('created_at')]
            if not order_dates:
                logger.error("No valid order dates found in product rows")
                return {
                    "status": "error",
                    "message": "Product rows missing created_at timestamps",
                    "rows_synced": 0,
                    "orders_processed": 0
                }
            most_recent_order_date = max(order_dates)
            
            # Import the product rows into the test table atomically with metadata
            logger.info(f"Importing {len(product_rows)} product rows from {unique_orders} orders to test table")
            try:
                result = self.repo.import_batch_with_metadata(
                    table_name='test_magento_data',
                    product_rows=product_rows,
                    region='test',
                    last_order_date=most_recent_order_date,
                    orders_count=unique_orders,
                    username=username
                )
                logger.info(f"Test sync: atomically committed {result['rows_imported']} rows and metadata")
            except Exception as e:
                logger.error(f"Failed to import test sync atomically: {e}")
                return {
                    "status": "error",
                    "message": f"Failed to sync test data: {str(e)}",
                    "rows_synced": 0,
                    "orders_processed": 0
                }
            
            if result['success']:
                rows_imported = result['rows_imported']
                rows_skipped = result.get('rows_skipped', 0)
                
                if rows_imported > 0 and rows_skipped > 0:
                    message = f"Test sync: {rows_imported} new rows from {unique_orders} orders ({rows_skipped} duplicates skipped)"
                elif rows_imported > 0:
                    message = f"Test sync complete! Synced {rows_imported} product rows from {unique_orders} orders to test_magento_data"
                else:
                    message = f"All {len(product_rows)} rows from {unique_orders} orders already exist (no new data)"
                
                return {
                    "status": "success",
                    "message": message,
                    "rows_synced": rows_imported,
                    "rows_skipped": rows_skipped,
                    "orders_processed": unique_orders,
                    "errors": result.get('errors', [])
                }
            else:
                return {
                    "status": "error",
                    "message": "No rows were synced",
                    "rows_synced": 0,
                    "orders_processed": 0,
                    "errors": result.get('errors', [])
                }
                
        except ValueError as e:
            logger.error(f"Validation error in test sync: {e}")
            return {
                "status": "error",
                "message": str(e),
                "rows_synced": 0,
                "orders_processed": 0
            }
        except Exception as e:
            logger.error(f"Error in test sync: {e}", exc_info=True)
            return {
                "status": "error",
                "message": f"Test sync failed: {str(e)}",
                "rows_synced": 0,
                "orders_processed": 0
            }
    
    def get_region_data(self, region: str, limit: int = 100, offset: int = 0, search: str = "", fields: list = None) -> Dict[str, Any]:
        """Get magento data for a specific region with optional field selection"""
        try:
            table_name = self._get_table_name(region)
            result = self.repo.get_magento_data(table_name, limit, offset, search, fields)
            return {
                "status": "success",
                "region": region,
                **result
            }
        except ValueError as e:
            logger.error(f"Invalid region: {e}")
            return {
                "status": "error",
                "message": str(e),
                "data": [],
                "total_count": 0
            }
        except Exception as e:
            logger.error(f"Error getting {region} data: {e}")
            return {
                "status": "error",
                "message": f"Failed to get data: {str(e)}",
                "data": [],
                "total_count": 0
            }
    
    def import_csv(self, region: str, csv_content: str, filename: str = None, username: str = None) -> Dict[str, Any]:
        """
        Import CSV data for a specific region and refresh condensed data.
        NOTE: This method is deprecated. Use sync_magento_data() instead for live data.
        """
        try:
            table_name = self._get_table_name(region)
            result = self.repo.import_csv_data(table_name, csv_content, filename, username)
            
            if result['success']:
                # Auto-create MD variant aliases for any new -MD SKUs in the imported data
                try:
                    alias_result = self.repo.auto_create_md_variant_aliases()
                    logger.info(f"Auto-created {alias_result.get('aliases_created', 0)} MD variant aliases after import")
                except Exception as e:
                    logger.warning(f"Could not auto-create MD variant aliases after import: {e}")
                
                # Refresh condensed data after import
                try:
                    condensed_result = self.repo.refresh_condensed_data(region)
                    logger.info(f"Refreshed condensed data for {region}: {condensed_result['rows_aggregated']} SKUs")
                except Exception as e:
                    logger.error(f"Failed to refresh condensed data for {region}: {e}")
                
                return {
                    "status": "success",
                    "message": f"Successfully imported {result['rows_imported']} rows to {region.upper()} magento",
                    "rows_imported": result['rows_imported'],
                    "errors": result['errors']
                }
            else:
                return {
                    "status": "error",
                    "message": "No rows were imported",
                    "rows_imported": 0,
                    "errors": result['errors']
                }
        except ValueError as e:
            logger.error(f"Invalid region: {e}")
            return {
                "status": "error",
                "message": str(e),
                "rows_imported": 0
            }
        except Exception as e:
            logger.error(f"Error importing CSV to {region}: {e}")
            return {
                "status": "error",
                "message": f"Failed to import CSV: {str(e)}",
                "rows_imported": 0
            }
    
    def sync_magento_data(
        self, 
        region: str, 
        start_date: str = None, 
        end_date: str = None,
        max_orders: int = None,
        username: str = None,
        progress_callback: callable = None,
        cancelled: callable = None
    ) -> Dict[str, Any]:
        """
        Sync live Magento data for a specific region with resumable sync support.
        
        Fetches orders from Magento API and breaks them down into product-level rows.
        Uses sync metadata to track progress and resume from last synced order.
        Saves metadata incrementally after each batch to handle cancellations gracefully.
        
        Args:
            region: Region to sync (uk, fr, nl)
            start_date: Optional start date filter (YYYY-MM-DD HH:MM:SS) - overrides metadata
            end_date: Optional end date filter (YYYY-MM-DD HH:MM:SS)
            max_orders: Optional maximum number of orders to fetch
            username: User performing the sync
            progress_callback: Optional callback for progress updates
            cancelled: Optional callable that returns True if sync should be cancelled
        
        Returns:
            Dict with status, message, and sync statistics
        """
        try:
            table_name = self._get_table_name(region)
            
            # Get last sync metadata to enable resumable sync
            if not start_date:
                metadata = self.repo.get_sync_metadata(region)
                if metadata and metadata.get('last_synced_order_date'):
                    # Convert timestamp to string format for Magento API
                    last_date = metadata['last_synced_order_date']
                    start_date = last_date.strftime('%Y-%m-%d %H:%M:%S')
                    logger.info(f"Resuming sync from last synced order: {start_date}")
                    if progress_callback:
                        progress_callback(f"Resuming from {start_date}...")
            
            # Verify last order was completely saved before continuing
            if start_date:
                completeness_check = self.repo.verify_order_completeness(table_name, start_date, region=region)
                if not completeness_check['is_complete']:
                    logger.warning(f"Last order incomplete: {completeness_check['message']}")
                    # Re-sync the incomplete order by using the date before it
                    if completeness_check.get('suggested_start_date'):
                        start_date = completeness_check['suggested_start_date']
                        logger.info(f"Re-syncing from {start_date} to complete partial order")
            
            # Initialize Magento client for this region
            logger.info(f"Initializing Magento client for region: {region}")
            client = MagentoDataClient(region=region)
            
            # Fetch product-level rows from Magento with batch processing
            logger.info(f"Fetching orders from Magento for region: {region}")
            batch_result = client.fetch_orders_product_breakdown_batched(
                table_name=table_name,
                region=region,
                start_date=start_date,
                end_date=end_date,
                max_orders=max_orders,
                username=username,
                repo=self.repo,
                progress_callback=progress_callback,
                cancelled=cancelled
            )
            
            if batch_result['was_cancelled']:
                return {
                    "status": "cancelled",
                    "message": f"Sync cancelled after processing {batch_result['orders_processed']} orders",
                    "rows_synced": batch_result['rows_imported'],
                    "orders_processed": batch_result['orders_processed']
                }
            
            if batch_result['orders_processed'] == 0:
                return {
                    "status": "success",
                    "message": "No new data to sync from Magento",
                    "rows_synced": 0,
                    "orders_processed": 0
                }
            
            # All metadata is already saved incrementally during batch processing
            logger.info(f"Sync complete: {batch_result['rows_imported']} rows from {batch_result['orders_processed']} orders")
            
            # Auto-create MD variant aliases
            try:
                alias_result = self.repo.auto_create_md_variant_aliases()
                logger.info(f"Auto-created {alias_result.get('aliases_created', 0)} MD variant aliases after sync")
            except Exception as e:
                logger.warning(f"Could not auto-create MD variant aliases after sync: {e}")
            
            # Refresh condensed data after sync
            try:
                condensed_result = self.repo.refresh_condensed_data(region)
                logger.info(f"Refreshed condensed data for {region}: {condensed_result['rows_aggregated']} SKUs")
            except Exception as e:
                logger.error(f"Failed to refresh condensed data for {region}: {e}")
            
            return {
                "status": "success",
                "message": f"Successfully synced {batch_result['rows_imported']} product rows from {batch_result['orders_processed']} orders",
                "rows_synced": batch_result['rows_imported'],
                "orders_processed": batch_result['orders_processed']
            }
                
        except ValueError as e:
            logger.error(f"Invalid region: {e}")
            return {
                "status": "error",
                "message": str(e),
                "rows_synced": 0,
                "orders_processed": 0
            }
        except Exception as e:
            logger.error(f"Error syncing Magento data for {region}: {e}")
            return {
                "status": "error",
                "message": f"Failed to sync Magento data: {str(e)}",
                "rows_synced": 0,
                "orders_processed": 0
            }
    
    def get_condensed_data(self, region: str, limit: int = 100, offset: int = 0, search: str = "") -> Dict[str, Any]:
        """Get condensed (6-month aggregated) magento data for a specific region"""
        try:
            # Always refresh condensed data before retrieving to ensure it's up-to-date
            try:
                refresh_result = self.repo.refresh_condensed_data(region)
                logger.info(f"Auto-refreshed condensed data for {region}: {refresh_result['rows_aggregated']} SKUs")
            except Exception as refresh_error:
                logger.warning(f"Could not auto-refresh condensed data for {region}: {refresh_error}")
                # Continue with existing data even if refresh fails
            
            result = self.repo.get_condensed_data(region, limit, offset, search)
            return {
                "status": "success",
                "region": region,
                **result
            }
        except ValueError as e:
            logger.error(f"Invalid region: {e}")
            return {
                "status": "error",
                "message": str(e),
                "data": [],
                "total_count": 0
            }
        except Exception as e:
            logger.error(f"Error getting condensed {region} data: {e}")
            return {
                "status": "error",
                "message": f"Failed to get condensed data: {str(e)}",
                "data": [],
                "total_count": 0
            }
    
    def refresh_condensed_data_for_region(self, region: str) -> Dict[str, Any]:
        """Manually refresh condensed data for a specific region"""
        try:
            result = self.repo.refresh_condensed_data(region)
            return {
                "status": "success",
                "message": f"Successfully refreshed condensed data for {region.upper()}",
                "region": region,
                **result
            }
        except ValueError as e:
            logger.error(f"Invalid region: {e}")
            return {
                "status": "error",
                "message": str(e)
            }
        except Exception as e:
            logger.error(f"Error refreshing condensed data for {region}: {e}")
            return {
                "status": "error",
                "message": f"Failed to refresh condensed data: {str(e)}"
            }
    
    def refresh_all_condensed_data(self) -> Dict[str, Any]:
        """Manually refresh condensed data for all regions"""
        try:
            results = {}
            for region in ['uk', 'fr', 'nl']:
                try:
                    result = self.repo.refresh_condensed_data(region)
                    results[region] = {
                        "success": True,
                        "rows_aggregated": result['rows_aggregated']
                    }
                except Exception as e:
                    results[region] = {
                        "success": False,
                        "error": str(e)
                    }
                    logger.error(f"Failed to refresh condensed data for {region}: {e}")
            
            successful_regions = [r for r, res in results.items() if res['success']]
            total_rows = sum(res.get('rows_aggregated', 0) for res in results.values() if res['success'])
            
            return {
                "status": "success",
                "message": f"Refreshed condensed data for {len(successful_regions)}/3 regions",
                "results": results,
                "total_rows_aggregated": total_rows
            }
        except Exception as e:
            logger.error(f"Error refreshing all condensed data: {e}")
            return {
                "status": "error",
                "message": f"Failed to refresh condensed data: {str(e)}"
            }
    
    def get_condensed_data_custom_range(self, region: str, range_type: str, range_value: str, 
                                       use_exclusions: bool, limit: int = 100, offset: int = 0, 
                                       search: str = "") -> Dict[str, Any]:
        """Get condensed magento data with custom date range"""
        try:
            result = self.repo.get_condensed_data_custom_range(
                region, range_type, range_value, use_exclusions, limit, offset, search
            )
            return {
                "status": "success",
                "region": region,
                "range_type": range_type,
                "range_value": range_value,
                **result
            }
        except ValueError as e:
            logger.error(f"Invalid parameters: {e}")
            return {
                "status": "error",
                "message": str(e),
                "data": [],
                "total_count": 0
            }
        except Exception as e:
            logger.error(f"Error getting custom range data for {region}: {e}")
            return {
                "status": "error",
                "message": f"Failed to get custom range data: {str(e)}",
                "data": [],
                "total_count": 0
            }
    
    def create_md_variant_aliases(self) -> Dict[str, Any]:
        """Manually trigger MD variant alias creation"""
        try:
            result = self.repo.auto_create_md_variant_aliases()
            return {
                "status": "success",
                **result
            }
        except Exception as e:
            logger.error(f"Error creating MD variant aliases: {e}")
            return {
                "status": "error",
                "message": f"Failed to create MD variant aliases: {str(e)}"
            }
    
    def get_sku_aliases(self) -> Dict[str, Any]:
        """Get all SKU aliases"""
        try:
            aliases = self.repo.get_sku_aliases()
            return {
                "status": "success",
                "aliases": aliases,
                "count": len(aliases)
            }
        except Exception as e:
            logger.error(f"Error getting SKU aliases: {e}")
            return {
                "status": "error",
                "message": f"Failed to get SKU aliases: {str(e)}",
                "aliases": []
            }
    
    def add_sku_alias(self, alias_sku: str, unified_sku: str) -> Dict[str, Any]:
        """Add a new SKU alias mapping"""
        try:
            result = self.repo.add_sku_alias(alias_sku, unified_sku)
            
            # Refresh all condensed data to apply the new alias
            for region in ['uk', 'fr', 'nl']:
                try:
                    self.repo.refresh_condensed_data(region)
                except Exception as e:
                    logger.warning(f"Could not refresh condensed data for {region}: {e}")
            
            return {
                "status": "success",
                "message": f"SKU alias added: {alias_sku} → {unified_sku}",
                **result
            }
        except ValueError as e:
            return {
                "status": "error",
                "message": str(e)
            }
        except Exception as e:
            logger.error(f"Error adding SKU alias: {e}")
            return {
                "status": "error",
                "message": f"Failed to add SKU alias: {str(e)}"
            }
    
    def delete_sku_alias(self, alias_id: int) -> Dict[str, Any]:
        """Delete a SKU alias mapping"""
        try:
            result = self.repo.delete_sku_alias(alias_id)
            
            # Refresh all condensed data to remove the alias effect
            for region in ['uk', 'fr', 'nl']:
                try:
                    self.repo.refresh_condensed_data(region)
                except Exception as e:
                    logger.warning(f"Could not refresh condensed data for {region}: {e}")
            
            return {
                "status": "success",
                "message": "SKU alias deleted",
                **result
            }
        except ValueError as e:
            return {
                "status": "error",
                "message": str(e)
            }
        except Exception as e:
            logger.error(f"Error deleting SKU alias: {e}")
            return {
                "status": "error",
                "message": f"Failed to delete SKU alias: {str(e)}"
            }
    
    def get_import_history(self, limit: int = 100, offset: int = 0, region: str = None) -> Dict[str, Any]:
        """Get import history with pagination and optional region filter"""
        try:
            result = self.repo.get_import_history(limit, offset, region)
            return {
                "status": "success",
                **result
            }
        except Exception as e:
            logger.error(f"Error getting import history: {e}")
            return {
                "status": "error",
                "message": f"Failed to get import history: {str(e)}",
                "data": [],
                "total_count": 0
            }

    def auto_create_md_variant_aliases(self) -> Dict[str, Any]:
        """Auto-create SKU aliases for MD variants to merge with base SKUs"""
        try:
            result = self.repo.auto_create_md_variant_aliases()
            
            # Refresh all condensed data to apply the new aliases
            if result.get("aliases_created", 0) > 0:
                for region in ['uk', 'fr', 'nl']:
                    try:
                        self.repo.refresh_condensed_data(region)
                    except Exception as e:
                        logger.warning(f"Could not refresh condensed data for {region}: {e}")
            
            return {
                "status": "success",
                **result
            }
        except Exception as e:
            logger.error(f"Error auto-creating MD variant aliases: {e}")
            return {
                "status": "error",
                "message": f"Failed to auto-create MD variant aliases: {str(e)}",
                "aliases_created": 0,
                "aliases_skipped": 0
            }
    
    # ===== CONDENSED MAGENTO FILTER METHODS =====
    
    def search_customers(self, region: str, search_term: str) -> Dict[str, Any]:
        """Search for customers in magento data"""
        try:
            customers = self.repo.search_customers(region, search_term)
            return {
                "status": "success",
                "customers": customers
            }
        except ValueError as e:
            return {
                "status": "error",
                "message": str(e),
                "customers": []
            }
        except Exception as e:
            logger.error(f"Error searching customers: {e}")
            return {
                "status": "error",
                "message": f"Failed to search customers: {str(e)}",
                "customers": []
            }
    
    def get_excluded_customers(self, region: str) -> Dict[str, Any]:
        """Get excluded customers for a region"""
        try:
            customers = self.repo.get_excluded_customers(region)
            return {
                "status": "success",
                "customers": customers
            }
        except Exception as e:
            logger.error(f"Error getting excluded customers: {e}")
            return {
                "status": "error",
                "message": f"Failed to get excluded customers: {str(e)}",
                "customers": []
            }
    
    def add_excluded_customer(self, region: str, email: str, full_name: str, username: str) -> Dict[str, Any]:
        """Add customer to exclusion list"""
        try:
            result = self.repo.add_excluded_customer(region, email, full_name, username)
            return {
                "status": "success" if result["success"] else "info",
                **result
            }
        except Exception as e:
            logger.error(f"Error adding excluded customer: {e}")
            return {
                "status": "error",
                "message": f"Failed to add excluded customer: {str(e)}"
            }
    
    def remove_excluded_customer(self, customer_id: int) -> Dict[str, Any]:
        """Remove customer from exclusion list"""
        try:
            result = self.repo.remove_excluded_customer(customer_id)
            return {
                "status": "success" if result["success"] else "error",
                **result
            }
        except Exception as e:
            logger.error(f"Error removing excluded customer: {e}")
            return {
                "status": "error",
                "message": f"Failed to remove excluded customer: {str(e)}"
            }
    
    def get_grand_total_threshold(self, region: str) -> Dict[str, Any]:
        """Get grand total threshold for a region"""
        try:
            threshold = self.repo.get_grand_total_threshold(region)
            return {
                "status": "success",
                "threshold": threshold
            }
        except Exception as e:
            logger.error(f"Error getting grand total threshold: {e}")
            return {
                "status": "error",
                "message": f"Failed to get threshold: {str(e)}",
                "threshold": None
            }
    
    def set_grand_total_threshold(self, region: str, threshold: float, username: str) -> Dict[str, Any]:
        """Set grand total threshold for a region"""
        try:
            result = self.repo.set_grand_total_threshold(region, threshold, username)
            return {
                "status": "success",
                **result
            }
        except Exception as e:
            logger.error(f"Error setting grand total threshold: {e}")
            return {
                "status": "error",
                "message": f"Failed to set threshold: {str(e)}"
            }
    
    def get_qty_threshold(self, region: str) -> Dict[str, Any]:
        """Get quantity threshold for a region"""
        try:
            threshold = self.repo.get_qty_threshold(region)
            return {
                "status": "success",
                "qty_threshold": threshold
            }
        except Exception as e:
            logger.error(f"Error getting qty threshold: {e}")
            return {
                "status": "error",
                "message": f"Failed to get qty threshold: {str(e)}"
            }
    
    def set_qty_threshold(self, region: str, qty_threshold: int, username: str) -> Dict[str, Any]:
        """Set quantity threshold for a region"""
        try:
            result = self.repo.set_qty_threshold(region, qty_threshold, username)
            return {
                "status": "success",
                **result
            }
        except Exception as e:
            logger.error(f"Error setting qty threshold: {e}")
            return {
                "status": "error",
                "message": f"Failed to set qty threshold: {str(e)}"
            }
    
    def get_customer_groups(self, region: str) -> Dict[str, Any]:
        """Get all customer groups for a region"""
        try:
            groups = self.repo.get_customer_groups(region)
            return {
                "status": "success",
                "customer_groups": groups
            }
        except Exception as e:
            logger.error(f"Error getting customer groups: {e}")
            return {
                "status": "error",
                "message": f"Failed to get customer groups: {str(e)}",
                "customer_groups": []
            }
    
    def get_excluded_customer_groups(self, region: str) -> Dict[str, Any]:
        """Get list of excluded customer groups for a region"""
        try:
            groups = self.repo.get_excluded_customer_groups(region)
            return {
                "status": "success",
                "customer_groups": groups
            }
        except Exception as e:
            logger.error(f"Error getting excluded customer groups: {e}")
            return {
                "status": "error",
                "message": f"Failed to get excluded customer groups: {str(e)}",
                "customer_groups": []
            }
    
    def add_excluded_customer_group(self, region: str, customer_group: str, username: str) -> Dict[str, Any]:
        """Add a customer group to the exclusion list"""
        try:
            result = self.repo.add_excluded_customer_group(region, customer_group, username)
            return {
                "status": "success",
                **result
            }
        except Exception as e:
            logger.error(f"Error adding excluded customer group: {e}")
            return {
                "status": "error",
                "message": f"Failed to add customer group: {str(e)}"
            }
    
    def remove_excluded_customer_group(self, group_id: int) -> Dict[str, Any]:
        """Remove a customer group from the exclusion list"""
        try:
            result = self.repo.remove_excluded_customer_group(group_id)
            return {
                "status": "success",
                **result
            }
        except Exception as e:
            logger.error(f"Error removing excluded customer group: {e}")
            return {
                "status": "error",
                "message": f"Failed to remove customer group: {str(e)}"
            }
