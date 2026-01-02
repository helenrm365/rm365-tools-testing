"""
Magento Client Factory

Returns the appropriate client for interacting with Magento.
Currently configured to use the direct Database client (READ-ONLY).
"""
from typing import Optional
import logging

from .db_client import MagentoDBClient

logger = logging.getLogger(__name__)

# Singleton instance
_client: Optional[MagentoDBClient] = None


def get_magento_client() -> MagentoDBClient:
    """Get or create Magento client instance"""
    global _client
    if _client is None:
        _client = MagentoDBClient()
    return _client
