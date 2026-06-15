from typing import Dict, Any, List
import logging
from datetime import datetime
from dateutil.relativedelta import relativedelta
from .repo import MagentoDataRepo
from .client import MagentoDataClient

logger = logging.getLogger(__name__)


class MagentoDataService:
    """Service layer for magento data operations"""
    
    def __init__(self, repo: MagentoDataRepo = None):
        self.repo = repo or MagentoDataRepo()
    
    # Table name mapping for validation
    VALID_REGIONS = {
        'uk': 'uk_orders_cache',
        'fr': 'fr_orders_cache',
        'nl': 'nl_orders_cache',
        'test': 'test_magento_data'
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
        Creates uk_magento_orders_cache, fr_magento_orders_cache, nl_magento_orders_cache and their aggregated versions.
        Also populates aggregated tables with existing data and auto-creates MD variant aliases.
        """
        try:
            tables = self.repo.init_tables()
            
            # Auto-create MD variant aliases if there's existing data
            try:
                alias_result = self.repo.auto_create_md_variant_aliases()
                logger.info(f"Auto-created {alias_result.get('aliases_created', 0)} MD variant aliases")
            except Exception as e:
                logger.warning(f"Could not auto-create MD variant aliases: {e}")
            
            # Refresh aggregated data for all regions
            for region in ['uk', 'fr', 'nl']:
                try:
                    self.repo.refresh_aggregated_data(region)
                except Exception as e:
                    logger.warning(f"Could not refresh aggregated data for {region}: {e}")
            
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
        Test sync: Sync the latest 10 orders to test_magento_data table.
        First sync gets the 10 most recent orders.
        Subsequent syncs get the next 10 orders before the oldest synced order.
        This allows incremental testing with different batches of orders.
        
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
            
            # Get last sync metadata for test syncs
            # For test syncs, we use end_date to get orders BEFORE the oldest synced order
            end_date = None
            metadata = self.repo.get_sync_metadata('test')
            if metadata and metadata.get('last_synced_order_date'):
                # The last_synced_order_date represents the OLDEST order from the previous sync
                # We want orders created BEFORE this date
                last_date = metadata['last_synced_order_date']
                end_date = last_date.strftime('%Y-%m-%d %H:%M:%S')
                logger.info(f"Getting next 10 orders before: {end_date}")
                if progress_callback:
                    progress_callback(f"Getting next 10 orders before {end_date}...")
            else:
                logger.info(f"First test sync - getting latest {max_orders} orders")
                if progress_callback:
                    progress_callback(f"Getting latest {max_orders} orders...")
            
            # Initialize Magento client (uses UK credentials)
            logger.info(f"Initializing Magento client for test sync")
            client = MagentoDataClient(region="uk")
            
            # Fetch product-level rows from Magento
            # Use DESC order to get latest first, with end_date to get orders before last batch
            logger.info(f"Fetching {max_orders} orders from Magento for test")
            product_rows = client.fetch_orders_product_breakdown(
                end_date=end_date,
                max_orders=max_orders,
                progress_callback=progress_callback,
                sort_desc=True  # Get latest orders first
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
            
            # Find the OLDEST order date for metadata tracking (for test syncs)
            # This allows us to get orders before this date in the next sync
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
            # For test syncs, track the OLDEST order date so next sync gets orders before this
            oldest_order_date = min(order_dates)
            
            # Import the product rows into the test table atomically with metadata
            logger.info(f"Importing {len(product_rows)} product rows from {unique_orders} orders to test table")
            try:
                result = self.repo.import_batch_with_metadata(
                    table_name='test_magento_data',
                    product_rows=product_rows,
                    region='test',
                    last_order_date=oldest_order_date,  # Track oldest for next batch
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
    
    def get_region_data(self, region: str, limit: int = 100, offset: int = 0, search: str = "", fields: list = None, sort_by: str = None, sort_order: str = "desc") -> Dict[str, Any]:
        """Get magento data for a specific region with optional field selection.
        
        Uses the local cache (populated by nightly scheduler) for fast reads.
        """
        try:
            # All regions now use the local cache for fast reads
            # The cache is populated by the nightly scheduler via sync_magento_data()
            table_name = self._get_table_name(region)
            result = self.repo.get_magento_data(table_name, limit, offset, search, fields, sort_by, sort_order)
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
        Import CSV data for a specific region and refresh aggregated data.
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
                
                # Refresh aggregated data after import
                try:
                    aggregated_result = self.repo.refresh_aggregated_data(region)
                    logger.info(f"Refreshed aggregated data for {region}: {aggregated_result['rows_aggregated']} SKUs")
                except Exception as e:
                    logger.error(f"Failed to refresh aggregated data for {region}: {e}")
                
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
        resync_days: int = 7,
        username: str = None,
        progress_callback: callable = None,
        cancelled: callable = None,
        dry_run: bool = False
    ) -> Dict[str, Any]:
        """
        Sync live Magento data for a specific region with resumable sync support.
        
        Fetches orders from Magento Database and breaks them down into product-level rows.
        Uses sync metadata to track progress and resume from last synced order.
        Saves metadata incrementally after each batch to handle cancellations gracefully.
        
        Args:
            region: Region to sync (uk, fr, nl)
            start_date: Optional start date filter (YYYY-MM-DD HH:MM:SS) - overrides metadata
            end_date: Optional end date filter (YYYY-MM-DD HH:MM:SS)
            max_orders: Optional maximum number of orders to fetch
            resync_days: Number of days to re-sync to catch status/qty changes (default: 7)
            username: User performing the sync
            progress_callback: Optional callback for progress updates
            cancelled: Optional callable that returns True if sync should be cancelled
            dry_run: Optional dry-run flag
        
        Returns:
            Dict with status, message, and sync statistics
        """
        try:
            table_name = self._get_table_name(region)
            
            # Get last sync metadata to enable resumable sync
            if not start_date:
                metadata = self.repo.get_sync_metadata(region)
                if metadata and metadata.get('last_synced_order_date'):
                    # Convert timestamp to string format for Magento DB query
                    last_date = metadata['last_synced_order_date']
                    
                    # Go back resync_days to catch status/qty changes on recent orders
                    from datetime import timedelta
                    resync_from_date = last_date - timedelta(days=resync_days)
                    start_date = resync_from_date.strftime('%Y-%m-%d %H:%M:%S')
                    logger.info(f"Re-syncing last {resync_days} days from {start_date} to catch order updates")
                    if progress_callback:
                        progress_callback(f"Re-syncing from {start_date} (last {resync_days} days)...")
                else:
                    # First time sync: Default to last 6 months exactly
                    # This prevents trying to download the entire history of the shop on first run
                    six_months_ago = datetime.now() - relativedelta(months=6)
                    start_date = six_months_ago.strftime('%Y-%m-%d %H:%M:%S')
                    logger.info(f"First-time sync for {region}: Defaulting to {start_date}")
                    if progress_callback:
                        progress_callback(f"First-time sync: Fetching data from {start_date}...")
            
            # Verify last order was completely saved before continuing
            if start_date:
                completeness_check = self.repo.verify_order_completeness(table_name, start_date, region=region)
                if not completeness_check['is_complete']:
                    # This is normal - the exact sync timestamp may not match any orders
                    # (e.g., if orders were modified or timestamp was recorded between orders)
                    # The system handles this by falling back to the previous order date
                    if completeness_check.get('suggested_start_date'):
                        original_date = start_date
                        start_date = completeness_check['suggested_start_date']
                        logger.debug(f"Adjusting sync start: {original_date} -> {start_date} ({completeness_check['message']})")
                    else:
                        # Only warn if we can't recover
                        logger.warning(f"Last order incomplete and no fallback available: {completeness_check['message']}")
            
            # Initialize Magento client for this region
            logger.info(f"Initializing Magento client for region: {region}")
            logger.info(f"[SYNC DEBUG] Final start_date being used: {start_date}")
            client = MagentoDataClient(region=region)
            
            # Fetch product-level rows from Magento with batch processing
            logger.info(f"Fetching orders from Magento DB for region: {region} (dry_run: {dry_run})")
            batch_result = client.fetch_orders_product_breakdown_batched(
                table_name=table_name,
                region=region,
                start_date=start_date,
                end_date=end_date,
                max_orders=max_orders,
                username=username,
                repo=self.repo,
                progress_callback=progress_callback,
                cancelled=cancelled,
                dry_run=dry_run
            )
            
            if batch_result['was_cancelled']:
                return {
                    "status": "cancelled",
                    "message": f"Sync cancelled after processing {batch_result['orders_processed']} orders. Progress has been saved.",
                    "rows_synced": batch_result['rows_imported'],
                    "orders_processed": batch_result['orders_processed']
                }
            
            # Check if an error occurred during sync
            if batch_result.get('error'):
                error_msg = batch_result['error']
                if batch_result['orders_processed'] > 0:
                    # Partial progress was made before error
                    return {
                        "status": "error",
                        "message": f"Sync stopped due to error after {batch_result['orders_processed']} orders: {error_msg}. Progress has been saved - next sync will resume.",
                        "rows_synced": batch_result['rows_imported'],
                        "orders_processed": batch_result['orders_processed']
                    }
                else:
                    # No progress was made
                    return {
                        "status": "error",
                        "message": f"Sync failed: {error_msg}",
                        "rows_synced": 0,
                        "orders_processed": 0
                    }
            
            if batch_result['orders_processed'] == 0:
                return {
                    "status": "success",
                    "message": "No new data to sync from Magento",
                    "rows_synced": 0,
                    "orders_processed": 0
                }
            
            if dry_run:
                sim_ins = batch_result.get('sim_inserted', 0)
                sim_upd = batch_result.get('sim_updated', 0)
                msg = f"[Dry Run] Sync simulation complete. Would insert {sim_ins} new rows, update {sim_upd} dirty rows (out of {batch_result['orders_processed']} orders checked)."
                logger.info(msg)
                return {
                    "status": "success",
                    "message": msg,
                    "rows_synced": 0,
                    "orders_processed": batch_result['orders_processed'],
                    "sim_inserted": sim_ins,
                    "sim_updated": sim_upd
                }

            # All metadata is already saved incrementally during batch processing
            logger.info(f"Sync complete: {batch_result['rows_imported']} rows from {batch_result['orders_processed']} orders")
            
            # Auto-create MD variant aliases
            try:
                alias_result = self.repo.auto_create_md_variant_aliases()
                logger.info(f"Auto-created {alias_result.get('aliases_created', 0)} MD variant aliases after sync")
            except Exception as e:
                logger.warning(f"Could not auto-create MD variant aliases after sync: {e}")
            
            # Refresh aggregated data after sync
            try:
                aggregated_result = self.repo.refresh_aggregated_data(region)
                logger.info(f"Refreshed aggregated data for {region}: {aggregated_result['rows_aggregated']} SKUs")
            except Exception as e:
                logger.error(f"Failed to refresh aggregated data for {region}: {e}")
            
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
    
    def get_aggregated_data(self, region: str, limit: int = 100, offset: int = 0, search: str = "", sort_by: str = "", sort_order: str = "desc") -> Dict[str, Any]:
        """Get aggregated (6-month aggregated) magento data for a specific region.
        
        Uses pre-computed aggregated tables that are refreshed by the nightly scheduler.
        """
        try:
            # Aggregated data is pre-computed by the nightly scheduler
            # Just fetch from the aggregated table directly for fast reads
            result = self.repo.get_aggregated_data(region, limit, offset, search, sort_by, sort_order)
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
            logger.error(f"Error getting aggregated {region} data: {e}")
            return {
                "status": "error",
                "message": f"Failed to get aggregated data: {str(e)}",
                "data": [],
                "total_count": 0
            }
    
    def refresh_aggregated_data_for_region(self, region: str, dry_run: bool = False) -> Dict[str, Any]:
        """Manually refresh aggregated data for a specific region. Triggers a quick sync first."""
        try:
            # Trigger a sync to ensure data is up-to-date
            # If we have never synced before, only fetch the last 6 months (plus buffer) to speed up the first load
            # If we have synced before, just fetch the last 7 days (incremental)
            if dry_run:
                try:
                    metadata = self.repo.get_sync_metadata(region)
                    if not metadata or not metadata.get('last_synced_order_date'):
                        six_months_ago = datetime.now() - relativedelta(months=6)
                        start_date = six_months_ago.strftime('%Y-%m-%d %H:%M:%S')
                        sync_res = self.sync_magento_data(region, start_date=start_date, dry_run=True)
                    else:
                        sync_res = self.sync_magento_data(region, resync_days=7, dry_run=True)
                    sim_ins = sync_res.get('sim_inserted', 0)
                    sim_upd = sync_res.get('sim_updated', 0)
                    return {
                        "status": "success",
                        "message": f"[Dry Run] {region.upper()} Order Sync simulation complete. Would insert {sim_ins} new rows, update {sim_upd} dirty rows (out of {sync_res.get('orders_processed', 0)} orders checked).",
                        "region": region,
                        "rows_synced": 0,
                        "orders_processed": sync_res.get('orders_processed', 0),
                        "sim_inserted": sim_ins,
                        "sim_updated": sim_upd
                    }
                except Exception as e:
                    logger.error(f"Error simulating order sync for {region}: {e}")
                    return {
                        "status": "error",
                        "message": f"Simulation failed: {str(e)}",
                        "rows_synced": 0,
                        "orders_processed": 0
                    }

            try:
                metadata = self.repo.get_sync_metadata(region)
                if not metadata or not metadata.get('last_synced_order_date'):
                    # First time sync: Only get last 6 months exactly
                    six_months_ago = datetime.now() - relativedelta(months=6)
                    start_date = six_months_ago.strftime('%Y-%m-%d %H:%M:%S')
                    logger.info(f"First-time sync for {region}: Fetching data from {start_date}")
                    self.sync_magento_data(region, start_date=start_date)
                else:
                    # Incremental sync: Standard 7-day lookback
                    self.sync_magento_data(region, resync_days=7)
            except Exception as sync_error:
                logger.warning(f"Auto-sync failed during refresh for {region}: {sync_error}")
                # Continue with refresh even if sync fails
 
            result = self.repo.refresh_aggregated_data(region)
            return {
                "status": "success",
                "message": f"Successfully refreshed aggregated data for {region.upper()}",
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
            logger.error(f"Error refreshing aggregated data for {region}: {e}")
            return {
                "status": "error",
                "message": f"Failed to refresh aggregated data: {str(e)}"
            }
    
    def refresh_all_aggregated_data(self) -> Dict[str, Any]:
        """Manually refresh aggregated data for all regions"""
        try:
            results = {}
            for region in ['uk', 'fr', 'nl']:
                try:
                    result = self.repo.refresh_aggregated_data(region)
                    results[region] = {
                        "success": True,
                        "rows_aggregated": result['rows_aggregated']
                    }
                except Exception as e:
                    results[region] = {
                        "success": False,
                        "error": str(e)
                    }
                    logger.error(f"Failed to refresh aggregated data for {region}: {e}")
            
            successful_regions = [r for r, res in results.items() if res['success']]
            total_rows = sum(res.get('rows_aggregated', 0) for res in results.values() if res['success'])
            
            return {
                "status": "success",
                "message": f"Refreshed aggregated data for {len(successful_regions)}/3 regions",
                "results": results,
                "total_rows_aggregated": total_rows
            }
        except Exception as e:
            logger.error(f"Error refreshing all aggregated data: {e}")
            return {
                "status": "error",
                "message": f"Failed to refresh aggregated data: {str(e)}"
            }
    
    def get_shipping_methods(self, region: str) -> Dict[str, Any]:
        """Get distinct shipping methods for a region or all regions."""
        try:
            methods = self.repo.get_shipping_methods(region)
            return {
                "status": "success",
                "region": region,
                "shipping_methods": methods
            }
        except Exception as e:
            logger.error(f"Error getting shipping methods for {region}: {e}")
            return {
                "status": "error",
                "message": str(e),
                "shipping_methods": []
            }
    
    def backfill_shipping_methods(self, region: str, progress_callback=None, dry_run: bool = False) -> Dict[str, Any]:
        """
        Backfill shipping_method for all existing cached orders that have it missing.
        
        Pipeline architecture: fetches from Magento in 10k chunks and immediately
        writes each chunk to the PG cache before fetching the next. This means:
        - DB changes appear as it runs (not all at the end)
        - Memory usage is O(chunk_size) not O(total_orders)
        - Progress is smooth 0-100% with no artificial split
        - One Magento connection per region (no reconnect overhead)
        """
        from .client import MagentoDataClient
        
        regions_to_process = ['uk', 'fr', 'nl'] if region == 'all' else [region]
        total_updated = 0
        errors = []
        
        # Count total missing orders across all regions
        if progress_callback:
            progress_callback(0, "Counting orders missing shipping data...")
        
        total_missing = 0
        region_missing = {}
        for r in regions_to_process:
            try:
                table_name = self._get_table_name(r)
                missing = self.repo.get_orders_missing_shipping_method(table_name)
                region_missing[r] = missing
                total_missing += len(missing)
            except Exception as e:
                logger.error(f"Error counting missing orders for {r}: {e}")
                errors.append(f"{r}: {str(e)}")
        
        if total_missing == 0 and not errors:
            if progress_callback:
                progress_callback(100, "All orders already have shipping methods")
            return {
                "status": "success",
                "message": "All orders already have shipping methods",
                "rows_updated": 0
            }
            
        if dry_run:
            if progress_callback:
                progress_callback(100, f"[Dry Run] Backfill Shipping Methods simulation complete: would backfill shipping_method for {total_missing:,} orders.")
            return {
                "status": "success",
                "message": f"[Dry Run] Backfill/Shipping Methods simulation complete: would backfill shipping_method for {total_missing:,} orders.",
                "rows_updated": total_missing
            }
        
        region_count = len([r for r in regions_to_process if region_missing.get(r)])
        if progress_callback:
            progress_callback(1, f"Found {total_missing:,} orders across {region_count} region(s)")
        
        # Track global progress across all regions
        global_offset = 0
        
        for r in regions_to_process:
            missing_orders = region_missing.get(r, [])
            if not missing_orders:
                continue
            
            try:
                table_name = self._get_table_name(r)
                region_label = r.upper()
                # Capture loop vars for closure safety
                _table = table_name
                _label = region_label
                _offset = global_offset
                
                def on_chunk(chunk_map, fetched_so_far, total_for_region,
                             tbl=_table, lbl=_label, off=_offset):
                    """Called after each 10k chunk is fetched from Magento.
                    Immediately writes the chunk to PG cache."""
                    nonlocal total_updated
                    if chunk_map:
                        updated = self.repo.backfill_shipping_methods(tbl, chunk_map)
                        total_updated += updated
                    processed_now = off + fetched_so_far
                    pct = max(1, min(99, int((processed_now / total_missing) * 100)))
                    if progress_callback:
                        progress_callback(pct, f"{lbl}: {processed_now:,}/{total_missing:,} orders processed")
                
                client = MagentoDataClient(region=r)
                client.fetch_shipping_methods_bulk(missing_orders, chunk_callback=on_chunk)
                global_offset += len(missing_orders)
                
            except Exception as e:
                logger.error(f"Error backfilling shipping methods for {r}: {e}")
                errors.append(f"{r}: {str(e)}")
                global_offset += len(missing_orders)
        
        if progress_callback:
            progress_callback(100, f"Complete — updated {total_updated:,} rows")
        
        if errors:
            return {
                "status": "partial" if total_updated > 0 else "error",
                "message": f"Updated {total_updated:,} rows. Errors: {'; '.join(errors)}",
                "rows_updated": total_updated
            }
        
        return {
            "status": "success",
            "message": f"Backfilled shipping_method for {total_updated:,} rows",
            "rows_updated": total_updated
        }
    
    def get_aggregated_data_custom_range(self, region: str, range_type: str, range_value: str, 
                                       use_exclusions: bool, limit: int = 100, offset: int = 0, 
                                       search: str = "", shipping_method: str = "") -> Dict[str, Any]:
        """Get aggregated magento data with custom date range"""
        try:
            result = self.repo.get_aggregated_data_custom_range(
                region, range_type, range_value, use_exclusions, limit, offset, search, shipping_method
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
    
    # ===== ALL REGIONS (combined) METHODS =====

    def get_all_regions_data(self, limit: int = 100, offset: int = 0, search: str = "",
                             sort_by: str = None, sort_order: str = "desc") -> Dict[str, Any]:
        """Get combined full data from all regions with a region column."""
        try:
            result = self.repo.get_all_regions_data(limit, offset, search, sort_by, sort_order)
            return {
                "status": "success",
                **result
            }
        except Exception as e:
            logger.error(f"Error getting all-regions data: {e}")
            return {
                "status": "error",
                "message": f"Failed to get combined data: {str(e)}",
                "data": [],
                "total_count": 0
            }

    def get_all_regions_aggregated_data(self, limit: int = 100, offset: int = 0, search: str = "",
                                         sort_by: str = "", sort_order: str = "desc") -> Dict[str, Any]:
        """Get 6-month aggregated data broken down: UK 6M, FR 6M (FR+NL combined), Total 6M."""
        try:
            result = self.repo.get_all_regions_aggregated_data(limit, offset, search, sort_by, sort_order)
            return {
                "status": "success",
                **result
            }
        except Exception as e:
            logger.error(f"Error getting all-regions aggregated data: {e}")
            return {
                "status": "error",
                "message": f"Failed to get combined aggregated data: {str(e)}",
                "uk_data": [], "fr_data": [], "total_data": [],
                "uk_total_count": 0, "fr_total_count": 0, "total_total_count": 0
            }

    def get_all_regions_custom_range_data(self, range_type: str, range_value: str,
                                           use_exclusions: bool, limit: int = 100, offset: int = 0,
                                           search: str = "", shipping_method: str = "") -> Dict[str, Any]:
        """Get custom range aggregated data broken down: UK, FR (FR+NL), Total."""
        try:
            result = self.repo.get_all_regions_custom_range_data(
                range_type, range_value, use_exclusions, limit, offset, search, shipping_method
            )
            return {
                "status": "success",
                "range_type": range_type,
                "range_value": range_value,
                **result
            }
        except Exception as e:
            logger.error(f"Error getting all-regions custom range data: {e}")
            return {
                "status": "error",
                "message": f"Failed to get combined custom range data: {str(e)}",
                "uk_data": [], "fr_data": [], "total_data": [],
                "uk_total_count": 0, "fr_total_count": 0, "total_total_count": 0
            }

    def get_all_regions_aggregated_merged(self, limit: int = 100, offset: int = 0, search: str = "",
                                           sort_by: str = "", sort_order: str = "desc") -> Dict[str, Any]:
        """Get 6-month aggregated data as a single merged table with UK qty, FR qty, Total qty columns."""
        try:
            result = self.repo.get_all_regions_aggregated_merged(limit, offset, search, sort_by, sort_order)
            return {"status": "success", **result}
        except Exception as e:
            logger.error(f"Error getting all-regions aggregated merged data: {e}")
            return {"status": "error", "message": str(e), "data": [], "total_count": 0}

    def get_all_regions_custom_range_merged(self, range_type: str, range_value: str,
                                             use_exclusions: bool, limit: int = 100, offset: int = 0,
                                             search: str = "", sort_by: str = "", sort_order: str = "desc",
                                             shipping_method: str = "") -> Dict[str, Any]:
        """Get custom range aggregated data as a single merged table."""
        try:
            result = self.repo.get_all_regions_custom_range_merged(
                range_type, range_value, use_exclusions, limit, offset, search, sort_by, sort_order, shipping_method
            )
            return {"status": "success", "range_type": range_type, "range_value": range_value, **result}
        except Exception as e:
            logger.error(f"Error getting all-regions custom range merged data: {e}")
            return {"status": "error", "message": str(e), "data": [], "total_count": 0}

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
            
            # Refresh all aggregated data to apply the new alias
            for region in ['uk', 'fr', 'nl']:
                try:
                    self.repo.refresh_aggregated_data(region)
                except Exception as e:
                    logger.warning(f"Could not refresh aggregated data for {region}: {e}")
            
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
            
            # Refresh all aggregated data to remove the alias effect
            for region in ['uk', 'fr', 'nl']:
                try:
                    self.repo.refresh_aggregated_data(region)
                except Exception as e:
                    logger.warning(f"Could not refresh aggregated data for {region}: {e}")
            
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
            
            # Refresh all aggregated data to apply the new aliases
            if result.get("aliases_created", 0) > 0:
                for region in ['uk', 'fr', 'nl']:
                    try:
                        self.repo.refresh_aggregated_data(region)
                    except Exception as e:
                        logger.warning(f"Could not refresh aggregated data for {region}: {e}")
            
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
    
    # ===== AGGREGATED MAGENTO FILTER METHODS =====
    
    def search_customers(self, region: str, search_term: str) -> Dict[str, Any]:
        """Search for customers in magento data"""
        try:
            # Use client to search live Magento DB
            client = MagentoDataClient(region)
            customers = client.search_customers(search_term)
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
                "message": f"Error searching customers: {str(e)}",
                "customers": []
            }
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
    
    def add_excluded_customer(self, region: str, email: str, full_name: str, username: str,
                               rule_type: str = 'exclude_all', divisor: float = 2.0,
                               product_sku: str = None, product_name: str = None) -> Dict[str, Any]:
        """Add customer to exclusion list with optional rule configuration"""
        try:
            result = self.repo.add_excluded_customer(region, email, full_name, username,
                                                      rule_type, divisor, product_sku, product_name)
            # Handle conflict case (e.g., trying to add divide_all when exclude_all exists)
            if result.get("conflict"):
                return {
                    "status": "error",
                    **result
                }
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
    
    def update_excluded_customer_rule(self, customer_id: int, rule_type: str, divisor: float = 2.0,
                                       product_sku: str = None, product_name: str = None,
                                       username: str = None) -> Dict[str, Any]:
        """Update the exclusion rule for an existing excluded customer"""
        try:
            result = self.repo.update_excluded_customer_rule(customer_id, rule_type, divisor,
                                                              product_sku, product_name, username)
            return {
                "status": "success" if result["success"] else "error",
                **result
            }
        except Exception as e:
            logger.error(f"Error updating excluded customer rule: {e}")
            return {
                "status": "error",
                "message": f"Failed to update exclusion rule: {str(e)}"
            }
    
    def get_customer_products(self, region: str, customer_email: str, search: str = "") -> Dict[str, Any]:
        """Get products that a customer has ordered"""
        try:
            products = self.repo.get_customer_products(region, customer_email, search)
            return {
                "status": "success",
                "products": products
            }
        except Exception as e:
            logger.error(f"Error getting customer products: {e}")
            return {
                "status": "error",
                "message": f"Failed to get customer products: {str(e)}",
                "products": []
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
    
    def get_smart_qty_rules(self, region: str) -> List[Dict[str, Any]]:
        """Get all smart quantity rules for a region"""
        return self.repo.get_smart_qty_rules(region)
    
    def add_smart_qty_rule(self, region: str, threshold: int, action: str, divisor: float, username: str) -> Dict[str, Any]:
        """Add a smart quantity rule for a region"""
        return self.repo.add_smart_qty_rule(region, threshold, action, divisor, username)
    
    def remove_smart_qty_rule(self, rule_id: int) -> Dict[str, Any]:
        """Remove a specific smart quantity rule"""
        return self.repo.remove_smart_qty_rule(rule_id)
    
    def clear_all_smart_qty_rules(self, region: str) -> Dict[str, Any]:
        """Clear all smart quantity rules for a region"""
        return self.repo.clear_all_smart_qty_rules(region)
    
    def get_customer_groups(self, region: str) -> Dict[str, Any]:
        """Get all customer groups for a region"""
        try:
            # Use client to get groups from live Magento DB
            client = MagentoDataClient(region)
            groups = client.get_customer_groups()
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
    
    def get_all_sync_metadata(self) -> Dict[str, Any]:
        """Get sync metadata for all regions"""
        try:
            metadata = self.repo.get_all_sync_metadata()
            return {
                "status": "success",
                "data": metadata
            }
        except Exception as e:
            logger.error(f"Error getting sync metadata: {e}")
            return {
                "status": "error",
                "message": f"Failed to get sync metadata: {str(e)}",
                "data": []
            }

    def get_available_statuses(self, region: str) -> Dict[str, Any]:
        """Get available order statuses for a region"""
        try:
            statuses = self.repo.get_available_statuses(region)
            return {
                "status": "success",
                "region": region,
                "statuses": statuses
            }
        except Exception as e:
            logger.error(f"Error getting statuses for {region}: {e}")
            return {
                "status": "error",
                "message": str(e),
                "statuses": []
            }

    def get_excluded_statuses(self, region: str) -> Dict[str, Any]:
        """Get excluded statuses for a region"""
        try:
            excluded = self.repo.get_excluded_statuses(region)
            return {
                "status": "success",
                "region": region,
                "excluded": excluded
            }
        except Exception as e:
            logger.error(f"Error getting excluded statuses for {region}: {e}")
            return {
                "status": "error",
                "message": str(e),
                "excluded": []
            }

    def add_excluded_status(self, region: str, status: str, username: str) -> Dict[str, Any]:
        """Add a status to the exclusion list"""
        try:
            result = self.repo.add_excluded_status(region, status)
            return {
                "status": "success" if result["success"] else "info",
                **result
            }
        except Exception as e:
            logger.error(f"Error adding excluded status: {e}")
            return {
                "status": "error",
                "message": str(e)
            }

    def remove_excluded_status(self, status_id: int) -> Dict[str, Any]:
        """Remove a status from the exclusion list"""
        try:
            result = self.repo.remove_excluded_status(status_id)
            if result['success']:
                return {
                    "status": "success",
                    "message": result['message']
                }
            else:
                return {
                    "status": "error",
                    "message": result['message']
                }
        except Exception as e:
            logger.error(f"Error removing excluded status: {e}")
            return {
                "status": "error",
                "message": str(e)
            }

    def get_smart_date_rules(self, region: str) -> List[Dict[str, Any]]:
        """Get smart date rules for a region"""
        try:
            return self.repo.get_smart_date_rules(region)
        except Exception as e:
            logger.error(f"Error getting smart date rules for {region}: {e}")
            return []

    def add_smart_date_rule(self, region: str, start_date: str, end_date: str, action: str, value: float, username: str) -> Dict[str, Any]:
        """Add a smart date rule"""
        try:
            return self.repo.add_smart_date_rule(region, start_date, end_date, action, value)
        except Exception as e:
            logger.error(f"Error adding smart date rule: {e}")
            return {
                "success": False, 
                "message": str(e)
            }

    def remove_smart_date_rule(self, rule_id: int) -> Dict[str, Any]:
        """Remove a smart date rule"""
        try:
            result = self.repo.remove_smart_date_rule(rule_id)
            if result['success']:
                return {
                    "status": "success", 
                    "message": result['message']
                }
            else:
                return {
                    "status": "error", 
                    "message": result['message']
                }
        except Exception as e:
            logger.error(f"Error removing smart date rule: {e}")
            return {
                "status": "error", 
                "message": str(e)
            }

