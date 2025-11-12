from __future__ import annotations
from typing import Dict, Any, List, Optional
from datetime import datetime
import logging
import requests
import time

from .repo import AdjustmentsRepo
from core.config import settings

logger = logging.getLogger(__name__)


class AdjustmentsService:
    def __init__(self, repo: Optional[AdjustmentsRepo] = None):
        self.repo = repo or AdjustmentsRepo()
        self.zoho_enabled = getattr(settings, 'ZOHO_SYNC_ENABLED', False)
        self.zoho_org_id = getattr(settings, 'ZC_ORG_ID', None) if self.zoho_enabled else None
        
        try:
            self.repo.init_tables()
        except Exception as e:
            logger.warning(f"Could not initialize inventory tables: {e}")
        
    def _make_zoho_request(self, method: str, url: str, headers: dict, params: dict = None, json_data: dict = None, max_retries: int = 3) -> tuple[bool, dict, str]:
        """
        Make a Zoho API request with proper error handling and retries.
        
        Returns:
            tuple: (success: bool, response_data: dict, error_message: str)
        """
        for attempt in range(max_retries):
            try:
                if method.upper() == 'GET':
                    response = requests.get(url, headers=headers, params=params, timeout=30)
                elif method.upper() == 'POST':
                    response = requests.post(url, headers=headers, params=params, json=json_data, timeout=30)
                else:
                    return False, {}, f"Unsupported HTTP method: {method}"
                
                # Check for HTTP errors
                response.raise_for_status()
                
                try:
                    data = response.json()
                except ValueError:
                    return False, {}, f"Invalid JSON response from Zoho API"
                
                return True, data, ""
                
            except requests.exceptions.Timeout:
                error_msg = f"Request timed out (attempt {attempt + 1}/{max_retries})"
                if attempt == max_retries - 1:
                    return False, {}, f"Request timed out after {max_retries} attempts"
                logger.warning(f"{error_msg}, retrying...")
                time.sleep(2 ** attempt)  # Exponential backoff
                
            except requests.exceptions.ConnectionError:
                error_msg = f"Connection error to Zoho API (attempt {attempt + 1}/{max_retries})"
                if attempt == max_retries - 1:
                    return False, {}, f"Connection failed after {max_retries} attempts"
                logger.warning(f"{error_msg}, retrying...")
                time.sleep(2 ** attempt)
                
            except requests.exceptions.HTTPError as e:
                # Don't retry on 4xx client errors, but do retry on 5xx server errors
                if 400 <= response.status_code < 500:
                    return False, {}, f"HTTP {response.status_code}: {str(e)}"
                elif attempt == max_retries - 1:
                    return False, {}, f"HTTP {response.status_code} after {max_retries} attempts: {str(e)}"
                
                logger.warning(f"HTTP {response.status_code} (attempt {attempt + 1}/{max_retries}), retrying...")
                time.sleep(2 ** attempt)
                
            except requests.exceptions.RequestException as e:
                error_msg = f"Request exception: {str(e)} (attempt {attempt + 1}/{max_retries})"
                if attempt == max_retries - 1:
                    return False, {}, f"Request failed after {max_retries} attempts: {str(e)}"
                logger.warning(f"{error_msg}, retrying...")
                time.sleep(2 ** attempt)
                
        return False, {}, "Maximum retry attempts reached"
    
    def check_zoho_connection(self) -> Dict[str, Any]:
        """
        Check connectivity to Zoho Inventory API.
        Only works if Zoho integration is enabled.
        
        Returns:
            Dict with connection status, timing, and any error details
        """
        if not self.zoho_enabled:
            return {
                "status": "disabled",
                "connected": False,
                "message": "Zoho integration is disabled. Adjustments work locally without Zoho.",
                "timestamp": datetime.now().isoformat()
            }
        
        try:
            from modules._integrations.zoho.client import get_cached_inventory_token
            
            inventory_token = get_cached_inventory_token()
            if not inventory_token:
                return {
                    "status": "error",
                    "connected": False,
                    "message": "Failed to get Zoho token",
                    "timestamp": datetime.now().isoformat()
                }

            headers = {
                "Content-Type": "application/json",
                "Authorization": f"Zoho-oauthtoken {inventory_token}"
            }

            # Test with a simple API call to get organization info
            test_url = "https://www.zohoapis.eu/inventory/v1/organizations"
            start_time = time.time()
            
            success, data, error_msg = self._make_zoho_request('GET', test_url, headers)
            response_time = round((time.time() - start_time) * 1000)  # ms
            
            if success:
                return {
                    "status": "success",
                    "connected": True,
                    "message": "Zoho API connection successful",
                    "response_time_ms": response_time,
                    "timestamp": datetime.now().isoformat()
                }
            else:
                return {
                    "status": "error", 
                    "connected": False,
                    "message": f"Zoho API connection failed: {error_msg}",
                    "response_time_ms": response_time,
                    "timestamp": datetime.now().isoformat()
                }
                
        except Exception as e:
            return {
                "status": "error",
                "connected": False,
                "message": f"Connection test failed: {str(e)}",
                "timestamp": datetime.now().isoformat()
            }
    
    def get_pending_adjustments(self) -> List[Dict[str, Any]]:
        """Get all pending adjustments that haven't been synced to Zoho yet"""
        return self.repo.get_pending_adjustments()
    
    def get_sync_status(self) -> Dict[str, Any]:
        """Get overview of adjustment sync status"""
        try:
            pending = self.repo.get_pending_adjustments()
            
            recent_adjustments = self.repo.list_adjustments(limit=100)
            successful_syncs = [adj for adj in recent_adjustments if adj.get('status') == 'Success']
            failed_syncs = [adj for adj in recent_adjustments if adj.get('status') == 'Error']
            
            return {
                "pending_count": len(pending),
                "recent_successful": len(successful_syncs),
                "recent_failed": len(failed_syncs),
                "total_recent": len(recent_adjustments),
                "pending_items": [
                    {
                        "id": adj["id"],
                        "barcode": adj["barcode"], 
                        "quantity": adj["quantity"],
                        "field": adj["field"],
                        "reason": adj["reason"],
                        "created_at": adj["created_at"].isoformat() if adj.get("created_at") else None
                    } for adj in pending[:10]  # Show first 10 pending
                ],
                "message": f"{len(pending)} adjustments awaiting sync, {len(successful_syncs)} recent successes, {len(failed_syncs)} recent failures"
            }
            
        except Exception as e:
            logger.error(f"Error getting sync status: {e}")
            return {
                "error": str(e),
                "message": "Failed to get sync status"
            }

    def log_adjustment(self, *, barcode: str, quantity: int, reason: str, field: str) -> Dict[str, Any]:
        """
        Log an inventory adjustment to PostgreSQL and update inventory_metadata immediately.
        
        The adjustment is applied to inventory_metadata in real-time, providing immediate 
        local inventory tracking. If Zoho sync is enabled, the adjustment will be queued 
        for later sync to Zoho.
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
            import re
            barcode_parts = re.split(r'[\t\n\r]+|\s{2,}', clean_barcode)
            
            # Filter for valid Zoho item IDs (15+ digits starting with 7725780)
            valid_barcodes = []
            for part in barcode_parts:
                part = part.strip()
                if part and part.isdigit() and len(part) >= 15 and part.startswith('7725780'):
                    valid_barcodes.append(part)
            
            if not valid_barcodes:
                # Fallback: try the original input as a single barcode
                original_clean = re.sub(r'[^\d]', '', barcode.strip())
                if original_clean and original_clean.isdigit() and len(original_clean) >= 15:
                    sanitized_barcode = original_clean
                else:
                    raise ValueError(f"No valid Zoho item IDs found in barcode: '{barcode[:50]}...'")
            else:
                # Use the first valid barcode found
                sanitized_barcode = valid_barcodes[0]
            
            # Final validation
            if not sanitized_barcode.isdigit() or len(sanitized_barcode) < 15:
                raise ValueError(f"Invalid barcode format: '{sanitized_barcode}' - should be 15+ digit Zoho item ID")
            
            logger.info(f"Sanitized barcode from '{barcode[:50]}...' to '{sanitized_barcode}'")
            
            # 1. Create the adjustment log record with sanitized barcode
            adjustment_data = {
                'barcode': sanitized_barcode,
                'quantity': quantity,
                'reason': reason,
                'field': field,
                'status': None,  # Pending until synced
                'response_message': None
            }
            
            adjustment = self.repo.create_adjustment_log(adjustment_data)
            
            # 2. Immediately update inventory_metadata table based on the "Affect" selection
            # This provides real-time local inventory tracking regardless of Zoho sync status
            try:
                logger.info(f"🚀 IMMEDIATE UPDATE: Starting metadata update for real-time tracking")
                logger.info(f"   item_id={sanitized_barcode}, field={field}, delta={quantity}")
                self.repo.update_metadata_quantity(sanitized_barcode, field, quantity)
                logger.info(f"✅ IMMEDIATE UPDATE SUCCESS: inventory_metadata updated immediately")
                logger.info(f"   {sanitized_barcode} {field} += {quantity}")
            except Exception as e:
                logger.error(f"❌ IMMEDIATE UPDATE FAILED: inventory_metadata update failed for {sanitized_barcode}")
                logger.error(f"   Field: {field}, Quantity: {quantity}")
                logger.error(f"   Error: {e}")
                # Don't fail the adjustment logging if metadata update fails, but log the error
            
            sync_status = "queued for Zoho sync" if self.zoho_enabled else "Zoho sync disabled"
            logger.info(f"Adjustment logged for barcode {sanitized_barcode}, field {field}, quantity {quantity} - metadata updated immediately, {sync_status}")
            
            return {
                "status": "success", 
                "message": f"Adjustment logged and {field} updated immediately (affect: {field}). {sync_status.capitalize()}.",
                "adjustment": adjustment,
                "metadata_updated": {
                    "field": field,
                    "delta": quantity,
                    "item_id": sanitized_barcode
                },
                "zoho_enabled": self.zoho_enabled
            }
            
        except Exception as e:
            logger.error(f"Error logging adjustment: {e}")
            raise

    def sync_adjustments_to_zoho(self) -> Dict[str, Any]:
        """
        Sync pending adjustments from PostgreSQL to Zoho Inventory.
        Only works if Zoho integration is enabled.
        """
        if not self.zoho_enabled:
            return {
                "success_count": 0, 
                "error_count": 0, 
                "message": "Zoho sync is disabled. Adjustments are tracked locally in inventory_metadata only.",
                "zoho_enabled": False
            }
        
        try:
            from modules._integrations.zoho.client import get_cached_inventory_token
            
            inventory_token = get_cached_inventory_token()
            if not inventory_token:
                return {
                    "success_count": 0, 
                    "error_count": 0, 
                    "message": "Failed to refresh Zoho Inventory token",
                    "zoho_enabled": True
                }

            headers = {
                "Content-Type": "application/json",
                "Authorization": f"Zoho-oauthtoken {inventory_token}"
            }

            pending_adjustments = self.repo.get_pending_adjustments()
            
            success_count = 0
            error_count = 0

            for adjustment in pending_adjustments:
                record_id = adjustment['id']
                item_id = adjustment['barcode']  # Using barcode as item_id
                quantity = adjustment['quantity']
                reason = adjustment['reason']
                field = adjustment['field']

                try:
                    # 1. Get current available stock from Zoho
                    item_url = f"https://www.zohoapis.eu/inventory/v1/items/{item_id}"
                    params = {"organization_id": self.zoho_org_id}
                    
                    success, item_json, error_msg = self._make_zoho_request('GET', item_url, headers, params)
                    if not success:
                        self.repo.update_adjustment_status(
                            record_id, "Error", f"Network error fetching item: {error_msg}"
                        )
                        error_count += 1
                        continue

                    if item_json.get("code") != 0:
                        self.repo.update_adjustment_status(
                            record_id, "Error", f"Item lookup failed: {item_json.get('message', 'Check if barcode is correct item_id.')}"
                        )
                        error_count += 1
                        continue

                    current_qty = item_json.get("item", {}).get("available_stock", 0)

                    # 2. Determine adjustment direction
                    # The quantity in the log represents the ACTUAL change that should be applied
                    # If it's negative, it means stock removal; if positive, it means stock addition
                    adjust_qty = quantity

                    target_qty = current_qty + adjust_qty

                    # 3. Build Zoho inventory adjustment payload
                    payload = {
                        "date": datetime.now().strftime("%Y-%m-%d"),
                        "reason": reason,
                        "line_items": [{
                            "item_id": item_id,
                            "quantity_adjusted": adjust_qty
                        }]
                    }

                    # 4. Post adjustment to Zoho
                    inv_url = f"https://www.zohoapis.eu/inventory/v1/inventoryadjustments"
                    params = {"organization_id": self.zoho_org_id}
                    
                    success, inv_data, error_msg = self._make_zoho_request('POST', inv_url, headers, params, payload)
                    if not success:
                        self.repo.update_adjustment_status(record_id, "Error", f"Network error during adjustment: {error_msg}")
                        error_count += 1
                        continue

                    if inv_data.get("code") == 0:
                        # Success - update inventory_logs status only
                        # Note: inventory_metadata was already updated immediately during log_adjustment()
                        message = f"Synced to Zoho: adjusted by {adjust_qty} units. Final Zoho stock: {target_qty}"
                        self.repo.update_adjustment_status(record_id, "Success", message)
                        success_count += 1
                        
                        logger.info(f"✅ Zoho sync completed for {item_id}: {field} {quantity} (metadata was updated during logging)")

                    else:
                        # Error from Zoho API
                        msg_data = inv_data.get("message")
                        if isinstance(msg_data, list):
                            msg_data = " | ".join(msg_data)
                        message = f"Zoho API error: {msg_data or 'Unknown error'}"
                        self.repo.update_adjustment_status(record_id, "Error", message)
                        error_count += 1

                except Exception as e:
                    # Unexpected error (should be rare now with improved network handling)
                    self.repo.update_adjustment_status(record_id, "Error", f"Unexpected error: {str(e)}")
                    error_count += 1
                    logger.error(f"Unexpected error syncing adjustment {record_id}: {e}")

            return {
                "success_count": success_count,
                "error_count": error_count,
                "message": f"Sync completed: {success_count} successful, {error_count} failed",
                "zoho_enabled": True
            }

        except Exception as e:
            logger.error(f"Error syncing adjustments to Zoho: {e}")
            return {
                "success_count": 0,
                "error_count": 0,
                "message": f"Sync failed: {str(e)}",
                "zoho_enabled": True
            }

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

    def get_pending_adjustments(self) -> List[Dict[str, Any]]:
        """Get all pending adjustments"""
        try:
            return self.repo.get_pending_adjustments()
        except Exception as e:
            logger.error(f"Error getting pending adjustments: {e}")
            return []

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
                from datetime import datetime, timedelta
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
