"""
Scheduler for background tasks like daily order session resets
"""
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from datetime import datetime
import logging

logger = logging.getLogger(__name__)

# Global scheduler instance - uses UK timezone for consistent timing
# regardless of where the server is physically located
scheduler = AsyncIOScheduler(timezone='Europe/London')


# ============================================================
# Task Tracking Integration
# ============================================================
def _with_task_tracking(task_id: str, task_func):
    """
    Wrapper that adds task tracking to a scheduled function.
    This ensures scheduled runs are tracked just like manual runs.
    """
    def wrapped():
        from core.scheduler_api import is_task_running, mark_task_started, mark_task_completed
        
        # Check if already running (e.g., manual run in progress)
        if is_task_running(task_id):
            logger.warning(f"⚠️ Scheduled task '{task_id}' skipped - already running")
            return
        
        mark_task_started(task_id, started_by='scheduler', trigger='scheduled')
        try:
            task_func()
        finally:
            mark_task_completed(task_id)
    
    return wrapped


def reset_daily_order_sessions():
    """
    Reset all order sessions daily so they can be re-approved.
    
    This allows orders that are still in 'processing' status on Magento
    to reappear in the pending orders list for approval, even if they
    were previously approved/in-progress/completed.
    
    The reset:
    - Marks incomplete sessions (draft, in_progress, ready_to_check) as 'expired'
    - Keeps completed/cancelled sessions for historical tracking
    - Clears all takeover requests
    - Orders still in 'processing' on Magento will appear in pending list again
    """
    try:
        from modules.orders.order_fulfillment.db_repo import MagentoDbRepo
        
        logger.info("🔄 Starting daily order session reset...")
        
        repo = MagentoDbRepo()
        result = repo.reset_daily_sessions()
        
        logger.info(f"✅ Daily reset completed: {result}")
        
    except Exception as e:
        logger.error(f"❌ Error during daily order reset: {e}", exc_info=True)


def start_scheduler():
    """Start the background scheduler with all scheduled tasks"""
    from core.config import settings
    
    # Check if scheduler is enabled (allows disabling on secondary instances)
    if not settings.SCHEDULER_ENABLED:
        logger.info("📅 Scheduler disabled via SCHEDULER_ENABLED=false")
        return
    
    try:
        # Schedule daily reset at midnight (configurable)
        # Uses tracking wrapper to prevent duplicate runs
        scheduler.add_job(
            _with_task_tracking('order-session-reset', reset_daily_order_sessions),
            trigger=CronTrigger(hour=1, minute=45),  # Runs at 1:45 AM daily (testing)
            id='daily_order_reset',
            name='Daily Order Session Reset',
            replace_existing=True
        )
        
        # Schedule nightly inventory_metadata sync at 02:00
        # This runs all the sync operations that Label Generator and Inventory Management
        # would do on page load, keeping the data fresh overnight
        scheduler.add_job(
            _with_task_tracking('nightly-inventory-sync', sync_inventory_metadata_nightly),
            trigger=CronTrigger(hour=2, minute=0),  # Runs at 02:00 daily
            id='nightly_inventory_sync',
            name='Nightly Inventory Metadata Sync',
            replace_existing=True
        )
        
        logger.info("📅 Scheduler configured:")
        logger.info("  - Daily order reset: 00:00 (midnight)")
        logger.info("  - Nightly inventory sync: 02:00")
        
        # Start the scheduler
        scheduler.start()
        logger.info("✅ Background scheduler started successfully")
        
    except Exception as e:
        logger.error(f"❌ Failed to start scheduler: {e}", exc_info=True)


def sync_inventory_metadata_nightly():
    """
    Nightly sync job that keeps inventory_metadata fully up-to-date.
    
    This runs all the operations that Label Generator and Inventory Management
    would do on page load, but at night when no users are active.
    
    Operations performed (ORDER MATTERS):
    1. Sync UK/FR/NL Magento orders data (incremental 7-day lookback)
    2. Refresh aggregated order tables (6M rolling window)
    3. Sync Magento catalog products to inventory_metadata (sku, product_name)
    4. Merge identifier products (-MD, -SD, -DP, -NP, -MV variants)
    5. Generate item IDs for products without them
    6. Update variant_statuses for all products
    7. Update uk_6m_data and fr_6m_data in inventory_metadata (AFTER catalog sync!)
    
    Benefits:
    - Page loads are instant (data already synced)
    - Product names cached in inventory_metadata
    - 6M sales data always fresh
    - Variant statuses pre-computed
    """
    try:
        logger.info("🌙 Starting nightly inventory_metadata sync...")
        
        # ============================================================
        # STEP 1: Sync Magento order data for all regions
        # ============================================================
        try:
            from modules.magentodata.service import MagentoDataService
            
            magento_service = MagentoDataService()
            
            for region in ['uk', 'fr', 'nl']:
                try:
                    logger.info(f"  📥 Syncing {region.upper()} Magento orders...")
                    # refresh_aggregated_data_for_region does both:
                    # - Incremental sync (7-day lookback)
                    # - Refresh aggregated table
                    result = magento_service.refresh_aggregated_data_for_region(region)
                    if result.get('status') == 'success':
                        logger.info(f"  ✅ {region.upper()}: {result.get('rows_aggregated', 0)} rows aggregated")
                    else:
                        logger.warning(f"  ⚠️ {region.upper()}: {result.get('message', 'Unknown error')}")
                except Exception as e:
                    logger.error(f"  ❌ Failed to sync {region.upper()}: {e}")
                    # Continue with other regions even if one fails
                    
        except Exception as e:
            logger.error(f"  ❌ Failed to initialize Magento service: {e}")
        
        # ============================================================
        # STEP 2: Sync catalog products, merge variants, generate item IDs
        # (Must happen BEFORE 6M data sync so products exist to update)
        # ============================================================
        try:
            from modules.inventory.management.repo import InventoryManagementRepo
            
            repo = InventoryManagementRepo()
            
            # Step 2a: Sync Magento catalog to inventory_metadata (sku + product_name)
            logger.info("  📦 Syncing Magento catalog products to inventory_metadata...")
            sync_result = repo.sync_magento_products_to_inventory_metadata()
            logger.info(f"  ✅ Catalog sync: {sync_result.get('synced_records', 0)} synced, {sync_result.get('filtered_aw365', 0)} filtered")
            
            # Step 2b: Merge identifier products with base SKUs
            logger.info("  🔗 Merging identifier products (-MD, -SD, -DP, -NP, -MV)...")
            merge_result = repo.merge_identifier_products()
            logger.info(f"  ✅ Merged/deleted {merge_result.get('deleted', 0)} identifier products")
            
            # Step 2c: Generate item IDs for products without them
            logger.info("  🏷️ Generating item IDs for products without barcodes...")
            item_id_result = repo.ensure_all_products_have_item_ids()
            logger.info(f"  ✅ Generated {item_id_result.get('ids_generated', 0)} item IDs")
            
            # Step 2d: Update variant_statuses for all products
            logger.info("  🔄 Updating variant_statuses for all products...")
            repo.update_variant_statuses()
            logger.info(f"  ✅ Updated variant statuses")
            
        except Exception as e:
            logger.error(f"  ❌ Failed catalog sync operations: {e}")
        
        # ============================================================
        # STEP 3: Update 6M sales data in inventory_metadata
        # (Must happen AFTER catalog sync so products exist to update)
        # ============================================================
        try:
            from modules.inventory.management.magento_sync import sync_magento_to_inventory_metadata
            
            logger.info("  📊 Updating 6M sales data in inventory_metadata...")
            stats = sync_magento_to_inventory_metadata(dry_run=False)
            logger.info(f"  ✅ Updated {stats.get('updated_records', 0)} records with UK/FR 6M data")
            if stats.get('unmatched_skus'):
                logger.info(f"  ℹ️ {len(stats['unmatched_skus'])} SKUs in orders but not in catalog (likely AW365)")
                
        except Exception as e:
            logger.error(f"  ❌ Failed to update 6M sales data: {e}")
        
        
        logger.info("🌙 Nightly inventory_metadata sync completed!")
        
    except Exception as e:
        logger.error(f"❌ Error during nightly inventory sync: {e}", exc_info=True)


def shutdown_scheduler():
    """Shutdown the scheduler gracefully"""
    try:
        if scheduler.running:
            scheduler.shutdown(wait=False)
            logger.info("✅ Scheduler shut down successfully")
    except Exception as e:
        logger.error(f"❌ Error shutting down scheduler: {e}", exc_info=True)
