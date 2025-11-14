from __future__ import annotations
from typing import Dict, Any, List, Optional
from datetime import datetime, timedelta
import logging
import re

from .repo import AdjustmentsRepo

logger = logging.getLogger(__name__)


class AdjustmentsService:
    def __init__(self, repo: Optional[AdjustmentsRepo] = None):
        self.repo = repo or AdjustmentsRepo()
        
        try:
            self.repo.init_tables()
        except Exception as e:
            logger.warning(f"Could not initialize inventory tables: {e}")
    
    def get_pending_adjustments(self) -> List[Dict[str, Any]]:
        """Get all adjustments (renamed from pending for backwards compatibility)"""
        return self.repo.get_pending_adjustments()
    
    def log_adjustment(self, *, barcode: str, quantity: int, reason: str, field: str) -> Dict[str, Any]:
        """
        Log an inventory adjustment to PostgreSQL and update inventory_metadata immediately.
        
        The adjustment is applied to inventory_metadata in real-time, providing immediate 
        local inventory tracking. Smart shelf logic is applied:
        - If shelf_lt1_qty would go negative, it automatically takes from shelf_gt1_qty
        - If shelf_gt1_qty would go negative, it automatically takes from top_floor_total
        """
        try:
            if quantity == 0:
                raise ValueError("Adjustment quantity cannot be zero")
            
            if field not in ['shelf_lt1_qty', 'shelf_gt1_qty', 'top_floor_total']:
                raise ValueError("Invalid field type")
            
            # Validate and sanitize barcode input
            if not barcode or not isinstance(barcode, str):
                raise ValueError("Barcode is required and must be a string")
            
            # Clean barcode: remove tabs, newlines, and extra whitespace, then split
            clean_barcode = barcode.strip()
            
            # Split by tabs or large amounts of whitespace (indicating pasted data)
            barcode_parts = re.split(r'[\t\n\r]+|\s{2,}', clean_barcode)
            
            # Filter for valid item IDs (15+ digits starting with 7)
            valid_barcodes = []
            for part in barcode_parts:
                part = part.strip()
                if part and part.isdigit() and len(part) >= 15 and part.startswith('7'):
                    valid_barcodes.append(part)
            
            if not valid_barcodes:
                # Fallback: try the original input as a single barcode
                original_clean = re.sub(r'[^\d]', '', barcode.strip())
                if original_clean and original_clean.isdigit() and len(original_clean) >= 15:
                    sanitized_barcode = original_clean
                else:
                    raise ValueError(f"No valid item IDs found in barcode: '{barcode[:50]}...'")
            else:
                # Use the first valid barcode found
                sanitized_barcode = valid_barcodes[0]
            
            # Final validation
            if not sanitized_barcode.isdigit() or len(sanitized_barcode) < 15:
                raise ValueError(f"Invalid barcode format: '{sanitized_barcode}' - should be 15+ digit item ID")
            
            logger.info(f"Sanitized barcode from '{barcode[:50]}...' to '{sanitized_barcode}'")
            
            # Apply smart shelf logic if removing stock
            if quantity < 0:
                adjustment_result = self._apply_smart_shelf_logic(sanitized_barcode, field, quantity)
            else:
                # For adding stock, just update the specified field
                adjustment_result = [{
                    'field': field,
                    'delta': quantity,
                    'item_id': sanitized_barcode
                }]
            
            # Create adjustment log records for each field that was updated
            adjustments = []
            for adj in adjustment_result:
                adjustment_data = {
                    'barcode': adj['item_id'],
                    'quantity': adj['delta'],
                    'reason': reason,
                    'field': adj['field'],
                    'status': 'Success',  # Immediate success since no external sync
                    'response_message': 'Adjustment applied to inventory_metadata'
                }
                
                adjustment = self.repo.create_adjustment_log(adjustment_data)
                adjustments.append(adjustment)
                
                # Update inventory_metadata
                try:
                    logger.info(f"🚀 IMMEDIATE UPDATE: Starting metadata update for real-time tracking")
                    logger.info(f"   item_id={adj['item_id']}, field={adj['field']}, delta={adj['delta']}")
                    self.repo.update_metadata_quantity(adj['item_id'], adj['field'], adj['delta'])
                    logger.info(f"✅ IMMEDIATE UPDATE SUCCESS: inventory_metadata updated immediately")
                    logger.info(f"   {adj['item_id']} {adj['field']} += {adj['delta']}")
                except Exception as e:
                    logger.error(f"❌ IMMEDIATE UPDATE FAILED: inventory_metadata update failed for {adj['item_id']}")
                    logger.error(f"   Field: {adj['field']}, Quantity: {adj['delta']}")
                    logger.error(f"   Error: {e}")
                    raise
            
            logger.info(f"Adjustment logged for barcode {sanitized_barcode}, field {field}, quantity {quantity} - metadata updated immediately")
            
            return {
                "status": "success", 
                "message": f"Adjustment logged and inventory updated immediately.",
                "adjustment": adjustments[0] if len(adjustments) == 1 else adjustments,
                "metadata_updated": adjustment_result,
                "smart_shelf_applied": len(adjustment_result) > 1
            }
            
        except Exception as e:
            logger.error(f"Error logging adjustment: {e}")
            raise
    
    def _apply_smart_shelf_logic(self, item_id: str, initial_field: str, quantity: int) -> List[Dict[str, Any]]:
        """
        Apply smart shelf logic for stock removal:
        - If shelf_lt1_qty < abs(quantity), take remaining from shelf_gt1_qty
        - If shelf_gt1_qty < remaining, take from top_floor_total
        
        Returns list of field updates to apply
        """
        if quantity >= 0:
            # Not removing stock, no smart logic needed
            return [{'field': initial_field, 'delta': quantity, 'item_id': item_id}]
        
        # Get current inventory levels
        metadata = self.repo.get_item_metadata(item_id)
        if not metadata:
            # Item doesn't exist yet, just apply the adjustment as-is
            return [{'field': initial_field, 'delta': quantity, 'item_id': item_id}]
        
        current_shelf_lt1 = metadata.get('shelf_lt1_qty', 0) or 0
        current_shelf_gt1 = metadata.get('shelf_gt1_qty', 0) or 0
        current_top_floor = metadata.get('top_floor_total', 0) or 0
        
        needed = abs(quantity)  # How much stock we need to remove
        updates = []
        
        # Priority 1: Take from shelf_lt1_qty first (if that's what was requested or if it has stock)
        if initial_field == 'shelf_lt1_qty' or (initial_field != 'top_floor_total' and current_shelf_lt1 > 0):
            take_from_lt1 = min(needed, current_shelf_lt1)
            if take_from_lt1 > 0:
                updates.append({
                    'field': 'shelf_lt1_qty',
                    'delta': -take_from_lt1,
                    'item_id': item_id
                })
                needed -= take_from_lt1
        
        # Priority 2: Take from shelf_gt1_qty if needed
        if needed > 0 and (initial_field in ['shelf_lt1_qty', 'shelf_gt1_qty'] or current_shelf_gt1 > 0):
            take_from_gt1 = min(needed, current_shelf_gt1)
            if take_from_gt1 > 0:
                updates.append({
                    'field': 'shelf_gt1_qty',
                    'delta': -take_from_gt1,
                    'item_id': item_id
                })
                needed -= take_from_gt1
        
        # Priority 3: Take from top_floor_total if still needed
        if needed > 0:
            take_from_top = min(needed, current_top_floor)
            if take_from_top > 0:
                updates.append({
                    'field': 'top_floor_total',
                    'delta': -take_from_top,
                    'item_id': item_id
                })
                needed -= take_from_top
        
        # If we couldn't fulfill the entire request, warn but allow it
        if needed > 0:
            logger.warning(f"Insufficient stock for {item_id}: requested {abs(quantity)}, only {abs(quantity) - needed} available")
            # Still add a final adjustment for the shortfall to the originally requested field
            updates.append({
                'field': initial_field,
                'delta': -needed,
                'item_id': item_id
            })
        
        # If no updates were generated, just apply to the requested field
        if not updates:
            updates = [{'field': initial_field, 'delta': quantity, 'item_id': item_id}]
        
        return updates

    def list_adjustments(self, *, limit: int = 50, item_id: Optional[str] = None) -> List[Dict[str, Any]]:
        """List inventory adjustments"""
        try:
            return self.repo.list_adjustments(limit=limit, item_id=item_id)
        except Exception as e:
            logger.error(f"Error listing adjustments: {e}")
            return []

    def get_item_history(self, barcode: str, limit: int = 20) -> List[Dict[str, Any]]:
        """Get adjustment history for a specific item"""
        try:
            return self.repo.get_item_history(barcode, limit)
        except Exception as e:
            logger.error(f"Error getting item history: {e}")
            return []

    def get_adjustments_summary(self, start_date: str, end_date: str) -> Dict[str, Any]:
        """Get adjustments summary for date range"""
        try:
            return self.repo.get_adjustments_summary(start_date, end_date)
        except Exception as e:
            logger.error(f"Error getting adjustments summary: {e}")
            return {
                'total_adjustments': 0,
                'status_breakdown': {},
                'date_range': {'start': start_date, 'end': end_date}
            }

    def get_adjustment_history(self, item_id: str, limit: int = 50) -> Dict[str, Any]:
        """Get adjustment history for a specific item"""
        try:
            adjustments = self.repo.get_item_history(item_id, limit)
            return {
                "item_id": item_id,
                "adjustments": adjustments,
                "count": len(adjustments)
            }
        except Exception as e:
            logger.error(f"Error getting adjustment history: {e}")
            return {
                "item_id": item_id,
                "adjustments": [],
                "count": 0
            }

    def get_adjustment_summary(self, start_date=None, end_date=None) -> Dict[str, Any]:
        """Get adjustment summary within date range"""
        try:
            if start_date and end_date:
                return self.repo.get_adjustments_summary(
                    start_date.isoformat() if hasattr(start_date, 'isoformat') else str(start_date),
                    end_date.isoformat() if hasattr(end_date, 'isoformat') else str(end_date)
                )
            else:
                end = datetime.now()
                start = end - timedelta(days=30)
                return self.repo.get_adjustments_summary(start.isoformat(), end.isoformat())
        except Exception as e:
            logger.error(f"Error getting adjustment summary: {e}")
            return {
                'total_adjustments': 0,
                'status_breakdown': {},
                'date_range': {'start': str(start_date), 'end': str(end_date)}
            }

    def clean_corrupted_adjustments(self) -> Dict[str, Any]:
        """Clean up adjustments with corrupted barcode data (contains tabs, multiple IDs, etc.)"""
        try:
            corrupted_count = self.repo.mark_corrupted_adjustments_as_failed()
            return {
                "cleaned_count": corrupted_count,
                "message": f"Marked {corrupted_count} corrupted adjustments as failed"
            }
        except Exception as e:
            logger.error(f"Error cleaning corrupted adjustments: {e}")
            return {
                "cleaned_count": 0,
                "message": f"Failed to clean corrupted adjustments: {str(e)}"
            }
