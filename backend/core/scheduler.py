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
    - Archives completed sessions to a history file
    - Clears all active session data
    - Allows orders to flow through the approval process again
    """
    try:
        from modules.orders.order_fulfillment.repo import MagentoRepo
        
        logger.info("🔄 Starting daily order session reset...")
        
        repo = MagentoRepo()
        result = repo.reset_daily_sessions()
        
        logger.info(f"✅ Daily reset completed: {result}")
        
    except Exception as e:
        logger.error(f"❌ Error during daily order reset: {e}", exc_info=True)


def activate_daily_prices():
    """
    Daily price activation job - runs at 00:01 to activate pending prices.
    
    This job:
    1. Finds all prices where effective_date = today
    2. Logs each activation to sourcing_price_sync_log for auditing
    3. The actual price activation is automatic via temporal queries,
       this just creates audit trail entries
    
    This enables the Margin Reports and Supplier Comparison to always
    use the correct 'active' price based on effective dates.
    """
    try:
        from modules.inventory.sourcing.service import SourcingService
        
        logger.info("💰 Starting daily price activation check...")
        
        service = SourcingService()
        result = service.activate_prices_for_today()
        
        if result.get('prices_activated', 0) > 0:
            logger.info(f"✅ Daily price activation: {result['prices_activated']} prices now active")
            for detail in result.get('details', []):
                logger.info(f"   📊 {detail.get('internal_sku')}: "
                          f"{detail.get('supplier_name')} - "
                          f"£{detail.get('previous_price')} → £{detail.get('new_price')}")
        else:
            logger.info("✅ Daily price activation: No prices to activate today")
        
        if result.get('errors'):
            logger.warning(f"⚠️ {len(result['errors'])} errors during activation")
            for err in result.get('errors', []):
                logger.warning(f"   ❌ {err.get('internal_sku')}: {err.get('error')}")
        
    except Exception as e:
        logger.error(f"❌ Error during daily price activation: {e}", exc_info=True)


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
            trigger=CronTrigger(hour=0, minute=0),  # Runs at midnight daily
            id='daily_order_reset',
            name='Daily Order Session Reset',
            replace_existing=True
        )
        
        # Schedule daily price activation at 00:01
        # This runs 1 minute after midnight to ensure date has rolled over
        scheduler.add_job(
            _with_task_tracking('price-activation', activate_daily_prices),
            trigger=CronTrigger(hour=0, minute=1),  # Runs at 00:01 daily
            id='daily_price_activation',
            name='Daily Price Activation',
            replace_existing=True
        )
        
        # Schedule nightly inventory_metadata sync at 20:19
        # This runs all the sync operations that Label Generator and Inventory Management
        # would do on page load, keeping the data fresh overnight
        scheduler.add_job(
            _with_task_tracking('nightly-inventory-sync', sync_inventory_metadata_nightly),
            trigger=CronTrigger(hour=20, minute=19),  # Runs at 20:19 daily
            id='nightly_inventory_sync',
            name='Nightly Inventory Metadata Sync',
            replace_existing=True
        )
        
        logger.info("📅 Scheduler configured:")
        logger.info("  - Daily order reset: 00:00 (midnight)")
        logger.info("  - Daily price activation: 00:01")
        logger.info("  - Nightly inventory sync: 20:19")
        
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
