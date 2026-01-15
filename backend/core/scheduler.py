"""
Scheduler for background tasks like daily order session resets
"""
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from datetime import datetime
import logging

logger = logging.getLogger(__name__)

# Global scheduler instance
scheduler = AsyncIOScheduler()


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
    try:
        # Schedule daily reset at midnight (configurable)
        scheduler.add_job(
            reset_daily_order_sessions,
            trigger=CronTrigger(hour=0, minute=0),  # Runs at midnight daily
            id='daily_order_reset',
            name='Daily Order Session Reset',
            replace_existing=True
        )
        
        # Schedule daily price activation at 00:01
        # This runs 1 minute after midnight to ensure date has rolled over
        scheduler.add_job(
            activate_daily_prices,
            trigger=CronTrigger(hour=0, minute=1),  # Runs at 00:01 daily
            id='daily_price_activation',
            name='Daily Price Activation',
            replace_existing=True
        )
        
        logger.info("📅 Scheduler configured:")
        logger.info("  - Daily order reset: 00:00 (midnight)")
        logger.info("  - Daily price activation: 00:01")
        
        # Start the scheduler
        scheduler.start()
        logger.info("✅ Background scheduler started successfully")
        
    except Exception as e:
        logger.error(f"❌ Failed to start scheduler: {e}", exc_info=True)


def shutdown_scheduler():
    """Shutdown the scheduler gracefully"""
    try:
        if scheduler.running:
            scheduler.shutdown(wait=False)
            logger.info("✅ Scheduler shut down successfully")
    except Exception as e:
        logger.error(f"❌ Error shutting down scheduler: {e}", exc_info=True)
