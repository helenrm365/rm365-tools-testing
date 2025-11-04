# modules/_integrations/zoho/client.py
# modules/_integrations/zoho/client.py
# modules/_integrations/zoho/client.py
import requests
import logging
from typing import Dict , Tuple, Optional
from core.config import settings
import time

logger = logging.getLogger(__name__)

ZOHO_INVENTORY_BASE = "https://www.zohoapis.eu/inventory/v1"
ZOHO_ORG_ID = settings.ZC_ORG_ID

# Config (env-driven). You already have these in core.config.Settings.
CLIENT_ID: Optional[str] = settings.ZC_CLIENT_ID
CLIENT_SECRET: Optional[str] = settings.ZC_CLIENT_SECRET
REFRESH_TOKEN: Optional[str] = settings.ZC_REFRESH_TOKEN

# Optional override if you’re in EU/IN/… (defaults to .com)
# e.g. set ZOHO_ACCOUNTS_BASE=https://accounts.zoho.eu in your .env
ACCOUNTS_BASE: str = getattr(settings, "ZOHO_ACCOUNTS_BASE", "https://accounts.zoho.com")

_cached_token: Optional[str] = None
_last_refresh: float = 0.0
# Be conservative: refresh every 45 minutes
_TOKEN_TTL: int = 2700

def _require_creds():
    if not (CLIENT_ID and CLIENT_SECRET and REFRESH_TOKEN):
        raise RuntimeError("Zoho OAuth creds aren’t configured (ZC_CLIENT_ID/SECRET/REFRESH_TOKEN).")

def _refresh_token() -> str:
    """Exchange the refresh token for a new access token."""
    global _cached_token, _last_refresh
    _require_creds()

    url = f"{ACCOUNTS_BASE}/oauth/v2/token"
    data = {
        "grant_type": "refresh_token",
        "client_id": CLIENT_ID,
        "client_secret": CLIENT_SECRET,
        "refresh_token": REFRESH_TOKEN,
    }
    resp = requests.post(url, data=data, timeout=20)
    if not resp.ok:
        # Keep the error readable; Zoho returns JSON with 'error' on failure
        try:
            detail = resp.json()
        except Exception:
            detail = resp.text
        raise RuntimeError(f"Zoho token refresh failed: {resp.status_code} {detail}")

    body = resp.json()
    token = body.get("access_token")
    if not token:
        raise RuntimeError(f"Zoho token refresh response didn’t include access_token: {body}")

    _cached_token = token
    _last_refresh = time.time()
    return _cached_token

def _get_cached_token() -> str:
    """Return a valid access token, refreshing if stale."""
    global _cached_token, _last_refresh
    if not _cached_token or (time.time() - _last_refresh) > _TOKEN_TTL:
        return _refresh_token()
    return _cached_token

# -------- Public helpers (backwards-compatible names) --------

def get_cached_creator_token() -> str:
    """Historically used for Zoho Creator; same token if scopes are combined."""
    return _get_cached_token()

def get_cached_inventory_token() -> str:
    """Historically used for Zoho Inventory; same token if scopes are combined."""
    return _get_cached_token()

def zoho_auth_header() -> dict:
    """Convenience: Authorization header for requests."""
    return {"Authorization": f"Zoho-oauthtoken {_get_cached_token()}"}


def _base_of(sku: str) -> str:
    """Extract base SKU (before any dash suffix)."""
    return (sku or "").split("-")[0].strip()


def _resolve_zoho_item(sku_to_item_id: Dict[str, str], base: str) -> tuple[Optional[str], Optional[str]]:
    """
    Resolve a base SKU to its corresponding item_id from Zoho.

    Tries base first, then base-MD. Returns (sku_used, item_id) or (None, None) if not found.
    """
    md = f"{base}-MD"
    if base in sku_to_item_id:
        return base, sku_to_item_id[base]
    if md in sku_to_item_id:
        return md, sku_to_item_id[md]
    return None, None


def get_zoho_items_with_skus() -> Dict[str, str]:
    """
    Return map: { sku: item_id } from Zoho /items endpoint.
    """
    sku_to_item_id = {}
    page = 1

    while True:
        logger.info(f"Fetching Zoho items page {page}...")
        url = f"{ZOHO_INVENTORY_BASE}/items"
        headers = zoho_auth_header()
        params = {"organization_id": ZOHO_ORG_ID, "page": page, "per_page": 200}

        resp = requests.get(url, headers=headers, params=params, timeout=30)
        resp.raise_for_status()
        data = resp.json()

        items = data.get("items", [])
        if not items:
            break

        for item in items:
            sku = item.get("sku", "").strip()
            item_id = item.get("item_id", "").strip()
            status = item.get("status", "").lower() if item.get("status") else "unknown"

            if sku == "ME008":
                logger.info(f"[ZOHO DEBUG] Found ME008 → item_id={item_id}, status={status}")
            if sku and item_id:
                sku_to_item_id[sku] = item_id

        if not data.get("page_context", {}).get("has_more_page", False):
            break

        page += 1

    logger.info(f"Fetched {len(sku_to_item_id)} items from Zoho")
    logger.info(f"[CHECK] Final item_id for ME008: {sku_to_item_id.get('ME008')}")
    return sku_to_item_id


def get_zoho_items_with_skus_full() -> Dict[str, Tuple[str, str]]:
    """
    Return map: { sku: (item_id, product_name) } from Zoho /items endpoint.
    """
    sku_map: Dict[str, Tuple[str, str]] = {}
    page = 1

    while True:
        logger.info(f"[FULL] Fetching Zoho items page {page}...")
        url = f"{ZOHO_INVENTORY_BASE}/items"
        headers = zoho_auth_header()
        params = {"organization_id": ZOHO_ORG_ID, "page": page, "per_page": 200}

        resp = requests.get(url, headers=headers, params=params, timeout=30)
        resp.raise_for_status()
        data = resp.json()

        items = data.get("items", [])
        if not items:
            break

        for item in items:
            sku = (item.get("sku") or "").strip()
            item_id = (item.get("item_id") or "").strip()
            name = (item.get("name") or "").strip()
            if sku and item_id:
                sku_map[sku] = (item_id, name)

        if not data.get("page_context", {}).get("has_more_page", False):
            break
        page += 1

    logger.info(f"[FULL] Fetched {len(sku_map)} sku→(item_id,name) from Zoho")
    return sku_map
