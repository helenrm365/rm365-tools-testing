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
        
        logger.info("📅 Scheduler configured:")
        logger.info("  - Daily order reset: 00:00 (midnight)")
        
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
