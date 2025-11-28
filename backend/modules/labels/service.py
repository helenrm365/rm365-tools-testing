from __future__ import annotations
from typing import Dict, Any, List, Optional
from datetime import datetime
import logging
import traceback

from .repo import LabelsRepo

logger = logging.getLogger(__name__)


class LabelsService:
    def __init__(self, repo: Optional[LabelsRepo] = None):
        self.repo = repo or LabelsRepo()

    def get_label_data(self, start_date: str, end_date: str, search: str = "") -> Dict[str, Any]:
        """Get filtered label data for generation"""
        try:
            data = self.repo.get_sales_data(start_date, end_date, search)
            return {
                "status": "success",
                "data": data,
                "count": len(data)
            }
        except Exception as e:
            logger.error(f"Error getting label data: {e}")
            logger.error(traceback.format_exc())
            return {
                "status": "error",
                "message": str(e),
                "data": []
            }

    def generate_labels(self, start_date: str, end_date: str, search: str = "") -> Dict[str, Any]:
        """Generate label file"""
        try:
            data = self.repo.get_sales_data(start_date, end_date, search)
            
            if not data:
                return {
                    "status": "error",
                    "message": "No data found for the specified criteria"
                }
            
            # Generate label content
            from .generator import generate_label_content
            content = generate_label_content(data)
            
            return {
                "status": "success",
                "content": content,
                "count": len(data),
                "generated_at": datetime.now().isoformat()
            }
            
        except Exception as e:
            logger.error(f"Error generating labels: {e}")
            logger.error(traceback.format_exc())
            return {
                "status": "error",
                "message": str(e)
            }

    def get_recent_runs(self, limit: int = 10) -> List[Dict[str, Any]]:
        """Get recent label generation runs"""
        try:
            return self.repo.get_recent_runs(limit)
        except Exception as e:
            logger.error(f"Error getting recent runs: {e}")
            return []

    def save_run_history(self, run_data: Dict[str, Any]) -> bool:
        """Save label generation run to history"""
        try:
            self.repo.save_run_history(run_data)
            return True
        except Exception as e:
            logger.error(f"Error saving run history: {e}")
            return False