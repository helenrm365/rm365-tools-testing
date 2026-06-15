"""
Scheduler for background tasks like daily order session resets
"""
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from concurrent.futures import ThreadPoolExecutor, as_completed
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
        from core.scheduler_api import is_task_running, mark_task_started, mark_task_completed, get_conflicting_task
        
        # Check if already running (e.g., manual run in progress)
        if is_task_running(task_id):
            logger.warning(f"⚠️ Scheduled task '{task_id}' skipped - already running")
            return
        
        # Check for conflicting tasks (e.g. a sub-task is running)
        conflicting = get_conflicting_task(task_id)
        if conflicting:
            logger.warning(f"⚠️ Scheduled task '{task_id}' skipped - conflicting task '{conflicting}' is running")
            return
        
        mark_task_started(task_id, started_by='scheduler', trigger='scheduled')
        try:
            # Pass progress_callback=None for scheduled runs (no SSE listener)
            task_func(progress_callback=None)
        except TypeError:
            # Fallback for functions that don't accept progress_callback
            task_func()
        finally:
            mark_task_completed(task_id)
    
    return wrapped


def start_scheduler():
    """Start the background scheduler with all scheduled tasks"""
    from core.config import settings
    
    # Check if scheduler is enabled (allows disabling on secondary instances)
    if not settings.SCHEDULER_ENABLED:
        logger.info("📅 Scheduler disabled via SCHEDULER_ENABLED=false")
        return
    
    try:
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
        logger.info("  - Nightly inventory sync: 02:00")
        
        # Start the scheduler
        scheduler.start()
        logger.info("✅ Background scheduler started successfully")
        
    except Exception as e:
        logger.error(f"❌ Failed to start scheduler: {e}", exc_info=True)


def sync_inventory_metadata_nightly(progress_callback=None, dry_run: bool = False):
    """
    Nightly sync job that keeps inventory_metadata fully up-to-date.
    
    Operations performed (ORDER MATTERS):
    1. Sync UK/FR/NL Magento orders data (incremental 7-day lookback)
    2. Refresh aggregated order tables (6M rolling window)
    3. Sync Magento catalog products to inventory_metadata
    4. Merge identifier products (-MD, -SD, -DP, -NP, -MV variants)
    5. Update variant_statuses for all products
    6. Update uk_6m_data and fr_6m_data in inventory_metadata
    7. Sync branch inventory tables
    """
    try:
        logger.info(f"🌙 Starting nightly inventory_metadata sync... (dry_run: {dry_run})")
        
        if progress_callback:
            progress_callback(0, "Starting nightly inventory sync..." if not dry_run else "Starting nightly inventory sync dry-run simulation...")
        
        # STEP 1: Sync Magento order data for all regions in parallel (0-45%)
        if progress_callback:
            progress_callback(0, "Syncing UK/FR/NL Magento orders in parallel..." if not dry_run else "Simulating UK/FR/NL Magento orders sync...")
        
        regions = ['uk', 'fr', 'nl']
        region_errors = {}
        region_results = {}
        with ThreadPoolExecutor(max_workers=3) as executor:
            futures = {executor.submit(_sync_region_orders, r, dry_run=dry_run): r for r in regions}
            for future in as_completed(futures):
                region = futures[future]
                try:
                    region_results[region] = future.result()
                except Exception as e:
                    region_errors[region] = e
                    logger.error(f"  ❌ Failed to sync {region.upper()}: {e}")
        
        if region_errors:
            failed = ', '.join(r.upper() for r in region_errors)
            logger.warning(f"  ⚠️ Order sync completed with errors: {failed}")
        else:
            logger.info("  ✅ All region order syncs completed successfully")
        
        # STEP 2: Sync catalog products, merge variants (45-70%)
        if progress_callback:
            progress_callback(45, "Syncing Magento catalog products..." if not dry_run else "Simulating catalog products sync...")
        catalog_res = {}
        try:
            catalog_res = _sync_catalog_products(progress_callback, dry_run=dry_run)
        except Exception as e:
            logger.error(f"  ❌ Failed catalog sync operations: {e}")
        
        # STEP 3: Update 6M sales data (70-85%)
        if progress_callback:
            progress_callback(70, "Updating 6M sales data..." if not dry_run else "Simulating 6M sales data update...")
        sales_res = {}
        try:
            sales_res = _sync_6m_sales_data(dry_run=dry_run)
        except Exception as e:
            logger.error(f"  ❌ Failed to update 6M sales data: {e}")
        
        # STEP 4: Sync branch inventory tables (85-100%)
        if progress_callback:
            progress_callback(85, "Syncing branch inventory tables..." if not dry_run else "Simulating branch inventory tables sync...")
        branch_results = {}
        try:
            branch_results = _sync_branch_inventory(progress_callback, dry_run=dry_run)
        except Exception as e:
            logger.error(f"  ❌ Failed branch inventory sync: {e}")
        
        if dry_run:
            uk_res = region_results.get('uk', {})
            fr_res = region_results.get('fr', {})
            nl_res = region_results.get('nl', {})
            
            cat_sync_res = catalog_res.get('sync', {})
            cat_merge_res = catalog_res.get('merge', {})
            cat_variant_res = catalog_res.get('variant', {})
            
            bir_res = branch_results.get('uk-birmingham', {})
            lon_res = branch_results.get('uk-london', {})
            par_res = branch_results.get('fr-paris', {})
            
            report = (
                "[Dry Run] Nightly Inventory Sync Simulation Report\n"
                "==================================================\n\n"
                "1. Magento Orders Cache Sync:\n"
                f"   - UK: Would check {uk_res.get('orders_processed', 0)} orders (insert {uk_res.get('sim_inserted', 0)}, update {uk_res.get('sim_updated', 0)})\n"
                f"   - FR: Would check {fr_res.get('orders_processed', 0)} orders (insert {fr_res.get('sim_inserted', 0)}, update {fr_res.get('sim_updated', 0)})\n"
                f"   - NL: Would check {nl_res.get('orders_processed', 0)} orders (insert {nl_res.get('sim_inserted', 0)}, update {nl_res.get('sim_updated', 0)})\n\n"
                "2. Catalog Sync & Normalization:\n"
                f"   - Catalog: Would insert {cat_sync_res.get('sim_inserted', 0)} new products, update {cat_sync_res.get('sim_updated', 0)} names\n"
                f"   - Identifiers: Would merge/delete {cat_merge_res.get('deleted', 0)} variants, rename {cat_merge_res.get('renamed', 0)} to base SKU\n"
                f"   - Variant Statuses: Would update variant statuses for {cat_variant_res.get('sim_updated', 0)} products\n\n"
                "3. 6M Sales Data Sync:\n"
                f"   - Would update sales data for {sales_res.get('updated_records', 0)} products (out of {sales_res.get('total_skus', 0)} checked)\n\n"
                "4. Branch Inventory Sync:\n"
                f"   - UK Birmingham: Would insert {bir_res.get('inserted_count', 0)} new products (existing: {bir_res.get('existing_count', 0)})\n"
                f"   - UK London:     Would insert {lon_res.get('inserted_count', 0)} new products (existing: {lon_res.get('existing_count', 0)})\n"
                f"   - FR Paris:      Would insert {par_res.get('inserted_count', 0)} new products (existing: {par_res.get('existing_count', 0)})"
            )
            
            logger.info("🌙 Nightly inventory sync simulation complete!")
            if progress_callback:
                progress_callback(100, report)
        else:
            if progress_callback:
                progress_callback(100, "Nightly inventory sync complete!")
            logger.info("🌙 Nightly inventory_metadata sync completed!")
        
    except Exception as e:
        logger.error(f"❌ Error during nightly inventory sync: {e}", exc_info=True)
        if progress_callback:
            progress_callback(100, f"Error: {str(e)}")
        raise


# ============================================================
# Individual Sub-Task Functions (used by nightly sync AND manual runs)
# ============================================================

def _sync_region_orders(region: str, dry_run: bool = False):
    """Sync Magento order data for a single region."""
    from modules.magentodata.service import MagentoDataService
    magento_service = MagentoDataService()
    logger.info(f"  📥 Syncing {region.upper()} Magento orders... (dry_run: {dry_run})")
    result = magento_service.refresh_aggregated_data_for_region(region, dry_run=dry_run)
    if result.get('status') == 'success':
        if dry_run:
            logger.info(f"  ✅ {region.upper()} (Dry Run): Order sync simulation completed.")
        else:
            logger.info(f"  ✅ {region.upper()}: {result.get('rows_aggregated', 0)} rows aggregated")
    else:
        logger.warning(f"  ⚠️ {region.upper()}: {result.get('message', 'Unknown error')}")
    return result


def _sync_catalog_products(progress_callback=None, dry_run: bool = False):
    """Sync Magento catalog products, merge identifiers, update variant statuses."""
    from modules.inventory.management.repo import InventoryManagementRepo
    repo = InventoryManagementRepo()

    logger.info(f"  📦 Syncing Magento catalog products to inventory_metadata... (dry_run: {dry_run})")
    sync_result = repo.sync_magento_products_to_inventory_metadata(dry_run=dry_run)
    if dry_run:
        logger.info(f"  ✅ Catalog sync (Dry Run): Would insert {sync_result.get('sim_inserted', 0)}, update {sync_result.get('sim_updated', 0)}")
    else:
        logger.info(f"  ✅ Catalog sync: {sync_result.get('synced_records', 0)} synced, {sync_result.get('filtered_aw365', 0)} filtered")

    if progress_callback:
        progress_callback(55, "Merging identifier products...")
    logger.info(f"  🔗 Merging identifier products (-MD, -SD, -DP, -NP, -MV)... (dry_run: {dry_run})")
    merge_result = repo.merge_identifier_products(dry_run=dry_run)
    if dry_run:
        logger.info(f"  ✅ Normalization (Dry Run): Would merge {merge_result.get('deleted', 0)} variants, rename {merge_result.get('renamed', 0)}")
    else:
        logger.info(f"  ✅ Merged/deleted {merge_result.get('deleted', 0)} identifier products")

    if progress_callback:
        progress_callback(63, "Updating variant statuses...")
    logger.info(f"  🔄 Updating variant_statuses for all products... (dry_run: {dry_run})")
    variant_result = repo.update_variant_statuses(dry_run=dry_run)
    if dry_run:
        logger.info(f"  ✅ Variant statuses (Dry Run): Would update variant_statuses for {variant_result.get('sim_updated', 0)} products")
    else:
        logger.info("  ✅ Updated variant statuses")

    return {
        "sync": sync_result,
        "merge": merge_result,
        "variant": variant_result
    }


def _sync_6m_sales_data(dry_run: bool = False):
    """Update 6M sales data (uk_6m_data, fr_6m_data) in inventory_metadata."""
    from modules.inventory.management.magento_sync import sync_magento_to_inventory_metadata
    logger.info(f"  📊 Updating 6M sales data in inventory_metadata... (dry_run: {dry_run})")
    stats = sync_magento_to_inventory_metadata(dry_run=dry_run)
    if dry_run:
        logger.info(f"  ✅ [Dry Run] Would update {stats.get('updated_records', 0)} records with UK/FR 6M data")
    else:
        logger.info(f"  ✅ Updated {stats.get('updated_records', 0)} records with UK/FR 6M data")
    if stats.get('unmatched_skus'):
        logger.info(f"  ℹ️ {len(stats['unmatched_skus'])} SKUs in orders but not in catalog (likely AW365)")
    return stats


def _sync_branch_inventory(progress_callback=None, dry_run: bool = False):
    """Sync branch inventory tables from inventory_metadata."""
    from modules.inventory.management.branches.repo import BranchInventoryRepo
    logger.info(f"  🏢 Syncing branch inventory tables from inventory_metadata... (dry_run: {dry_run})")

    branch_configs = [
        ('uk-birmingham', 'uk_birmingham_inventory'),
        ('uk-london', 'uk_london_inventory'),
        ('fr-paris', 'fr_paris_inventory')
    ]

    results = {}
    for idx, (branch_id, table_name) in enumerate(branch_configs):
        try:
            pct = 85 + int(((idx + 1) / len(branch_configs)) * 15)
            if progress_callback:
                progress_callback(min(pct, 99), f"Syncing {branch_id} inventory...")
            repo = BranchInventoryRepo(branch_id=branch_id, table_name=table_name)
            result = repo.sync_from_inventory_metadata(dry_run=dry_run)
            results[branch_id] = result
            if dry_run:
                logger.info(f"  ✅ {branch_id} (Dry Run): Would sync {result.get('inserted_count', 0)} new products")
            else:
                logger.info(f"  ✅ {branch_id}: {result.get('inserted_count', 0)} new products synced")
        except Exception as e:
            logger.error(f"  ❌ Failed to sync {branch_id}: {e}")
            results[branch_id] = {"error": str(e)}
    return results


# ============================================================
# Individual manually-runnable sub-tasks (with progress_callback)
# ============================================================

def sync_region_orders_task(region: str, progress_callback=None, dry_run: bool = False):
    """Manually-runnable: sync orders for a single region."""
    try:
        label = region.upper()
        logger.info(f"🔧 Starting manual {label} order sync... (dry_run: {dry_run})")
        if progress_callback:
            progress_callback(0, f"Syncing {label} Magento orders...")
        res = _sync_region_orders(region, dry_run=dry_run)
        if progress_callback:
            if dry_run:
                sim_ins = res.get('sim_inserted', 0)
                sim_upd = res.get('sim_updated', 0)
                report = (
                    f"[Dry Run] {label} Order Sync Simulation Report\n"
                    "------------------------------------\n"
                    f"Orders Checked: {res.get('orders_processed', 0)}\n"
                    f"Would Insert: {sim_ins} new rows\n"
                    f"Would Update: {sim_upd} dirty rows"
                )
                progress_callback(100, report)
            else:
                progress_callback(100, f"{label} order sync complete!")
        logger.info(f"✅ Manual {label} order sync completed!")
    except Exception as e:
        logger.error(f"❌ Manual {region.upper()} order sync failed: {e}", exc_info=True)
        if progress_callback:
            progress_callback(100, f"Error: {str(e)}")
        raise


def sync_catalog_task(progress_callback=None, dry_run: bool = False):
    """Manually-runnable: sync catalog products, merge identifiers, update variant statuses."""
    try:
        logger.info(f"🔧 Starting manual catalog sync... (dry_run: {dry_run})")
        if progress_callback:
            progress_callback(0, "Syncing Magento catalog products...")

        # Re-map progress to 0-100 for standalone run
        def catalog_progress(pct, msg):
            if progress_callback:
                # Map 45-70 range to 0-100
                mapped = int(((pct - 45) / 25) * 100) if pct >= 45 else 0
                progress_callback(max(0, min(mapped, 100)), msg)

        res = _sync_catalog_products(catalog_progress, dry_run=dry_run)

        if progress_callback:
            if dry_run:
                sync_res = res.get('sync', {})
                merge_res = res.get('merge', {})
                variant_res = res.get('variant', {})
                report = (
                    "[Dry Run] Catalog Sync Simulation Report\n"
                    "------------------------------------\n"
                    f"Catalog Products: Would insert {sync_res.get('sim_inserted', 0)} new, update {sync_res.get('sim_updated', 0)} names\n"
                    f"Variants Normalization: Would merge/delete {merge_res.get('deleted', 0)}, rename {merge_res.get('renamed', 0)}\n"
                    f"Variant Statuses: Would update statuses for {variant_res.get('sim_updated', 0)} products"
                )
                progress_callback(100, report)
            else:
                progress_callback(100, "Catalog sync complete!")
        logger.info("✅ Manual catalog sync completed!")
    except Exception as e:
        logger.error(f"❌ Manual catalog sync failed: {e}", exc_info=True)
        if progress_callback:
            progress_callback(100, f"Error: {str(e)}")
        raise


def sync_6m_data_task(progress_callback=None, dry_run: bool = False):
    """Manually-runnable: update 6M sales data."""
    try:
        logger.info(f"🔧 Starting manual 6M sales data sync... (dry_run: {dry_run})")
        if progress_callback:
            progress_callback(0, "Updating 6M sales data...")
        res = _sync_6m_sales_data(dry_run=dry_run)
        if progress_callback:
            if dry_run:
                report = (
                    "[Dry Run] 6M Sales Data Sync Simulation Report\n"
                    "------------------------------------\n"
                    f"SKUs Checked: {res.get('total_skus', 0)}\n"
                    f"Would Update sales data for: {res.get('updated_records', 0)} products"
                )
                progress_callback(100, report)
            else:
                progress_callback(100, "6M sales data sync complete!")
        logger.info("✅ Manual 6M sales data sync completed!")
    except Exception as e:
        logger.error(f"❌ Manual 6M sales data sync failed: {e}", exc_info=True)
        if progress_callback:
            progress_callback(100, f"Error: {str(e)}")
        raise


def sync_branch_inventory_task(progress_callback=None, dry_run: bool = False):
    """Manually-runnable: sync branch inventory tables."""
    try:
        logger.info(f"🔧 Starting manual branch inventory sync... (dry_run: {dry_run})")
        if progress_callback:
            progress_callback(0, "Syncing branch inventory tables...")

        def branch_progress(pct, msg):
            if progress_callback:
                # Map 85-100 range to 0-100
                mapped = int(((pct - 85) / 15) * 100) if pct >= 85 else 0
                progress_callback(max(0, min(mapped, 100)), msg)

        res = _sync_branch_inventory(branch_progress, dry_run=dry_run)

        if progress_callback:
            if dry_run:
                report = ["[Dry Run] Branch Inventory Sync Simulation Report", "------------------------------------"]
                for b_id, b_res in res.items():
                    report.append(f"{b_id}: Would insert {b_res.get('inserted_count', 0)} new (existing: {b_res.get('existing_count', 0)})")
                progress_callback(100, "\n".join(report))
            else:
                progress_callback(100, "Branch inventory sync complete!")
        logger.info("✅ Manual branch inventory sync completed!")
    except Exception as e:
        logger.error(f"❌ Manual branch inventory sync failed: {e}", exc_info=True)
        if progress_callback:
            progress_callback(100, f"Error: {str(e)}")
        raise


def shutdown_scheduler():
    """Shutdown the scheduler gracefully"""
    try:
        if scheduler.running:
            scheduler.shutdown(wait=False)
            logger.info("✅ Scheduler shut down successfully")
    except Exception as e:
        logger.error(f"❌ Error shutting down scheduler: {e}", exc_info=True)
