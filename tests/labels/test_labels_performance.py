"""
Test script to measure label generator load time.
Run from the rm365-tools-testing directory:
    .venv/bin/python tests/labels/test_labels_performance.py
"""
import sys
import os
import time
import logging

# Add backend to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '../../backend'))

# Set up logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

def test_labels_to_print_performance():
    """Test the performance of get_labels_to_print_psycopg"""
    from core.db import get_inventory_log_connection, return_inventory_connection
    from modules.labels.repo import LabelsRepo
    
    logger.info("=" * 60)
    logger.info("TESTING LABELS TO-PRINT PERFORMANCE")
    logger.info("=" * 60)
    
    conn = None
    try:
        # Get connection
        conn = get_inventory_log_connection()
        repo = LabelsRepo()
        
        # Measure time
        start_time = time.time()
        
        # Call the method that powers /to-print endpoint
        result = repo.get_labels_to_print_psycopg(
            conn,
            product_statuses=['Active', 'Temporarily OOS', 'Pre Order', 'Samples'],
            preferred_region='uk',
            show_orphaned=False
        )
        
        end_time = time.time()
        elapsed = end_time - start_time
        
        logger.info("=" * 60)
        logger.info(f"RESULT: Loaded {len(result)} label rows")
        logger.info(f"TIME ELAPSED: {elapsed:.2f} seconds")
        logger.info("=" * 60)
        
        # Show sample rows
        if result:
            logger.info("Sample rows:")
            for row in result[:3]:
                logger.info(f"  - {row.get('sku')}: {row.get('product_name', 'N/A')[:50]}")
        
        return {
            "rows": len(result),
            "elapsed_seconds": elapsed
        }
        
    except Exception as e:
        logger.error(f"Error testing labels: {e}", exc_info=True)
        raise
    finally:
        if conn:
            return_inventory_connection(conn)

if __name__ == "__main__":
    result = test_labels_to_print_performance()
    print(f"\n\nFINAL RESULT: {result['rows']} rows in {result['elapsed_seconds']:.2f} seconds")
