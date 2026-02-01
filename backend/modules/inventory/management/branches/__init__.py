"""
Branch-specific Inventory Management Module
Supports multiple warehouse branches: uk-birmingham, uk-london, fr-paris
"""
from .api import uk_birmingham_router, uk_london_router, fr_paris_router, BRANCH_CONFIG
from .repo import BranchInventoryRepo
from .service import BranchInventoryService

__all__ = [
    'uk_birmingham_router',
    'uk_london_router', 
    'fr_paris_router',
    'BRANCH_CONFIG',
    'BranchInventoryRepo',
    'BranchInventoryService'
]
