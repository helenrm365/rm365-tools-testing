# backend/modules/inventory/sourcing/pdf_ai.py
"""
Gemini-backed Intelligent Document Processing (IDP) helpers for the supplier
PDF importer.

This module is the ONLY place that talks to the AI provider. It exposes two
narrow capabilities used as fallback tiers by ``service.import_matrix_pdf``:

  • ``request_layout_profile(page_text)``  — Tier 2. Cheap, text-only call that
    asks Gemini for a *semantic* description of the line-item table (which header
    label means what, the column order, the rule that starts a new row, and the
    noise patterns to drop). The deterministic parser then re-runs using those
    hints. The profile is cached per supplier-format, so this costs tokens at
    most once per format.

  • ``extract_line_items(pdf_bytes)``       — Tier 3. Last-resort multimodal call
    that hands Gemini the raw PDF and gets structured line items back (plus the
    date printed on each page, harvested in the same call). Used only when the
    deterministic passes (with or without a layout profile) still fail.

  • ``extract_page_dates(pdf_bytes)``       — date-only multimodal call. Used when
    a deterministic/layout parse already produced the items (so Tier 3 never ran)
    but a multi-price conflict still needs each price dated by its page.

Design rules:
  - Never raises into the caller's happy path: callers catch ``PdfAiUnavailable``
    and fall back to the deterministic parser, so a missing key / disabled flag /
    network error degrades gracefully to today's behaviour.
  - No new heavy dependency — uses ``httpx`` (already required) against the
    Gemini REST API with a strict ``responseSchema`` for reliable JSON.
"""
from __future__ import annotations

import base64
import logging
import time
from typing import Dict, List, Optional, Tuple

import httpx

from core.config import settings

logger = logging.getLogger(__name__)

_API_ROOT = "https://generativelanguage.googleapis.com/v1beta/models"

# Bounded retry for TRANSIENT failures only (rate limit / server-side / network).
# A 503 "high demand" is rejected before the model runs, so it costs no tokens —
# only a request. We give up after _MAX_RETRIES extra attempts and let the caller
# fall back, so a genuinely-down or misconfigured endpoint can never loop. A 4xx
# (bad request / bad key) or a malformed-but-billed 200 is NOT retried.
_MAX_RETRIES = 2  # total attempts = 1 + _MAX_RETRIES
_RETRY_STATUSES = frozenset({429, 500, 502, 503, 504})
_RETRY_BACKOFF = (1.0, 2.0)  # seconds before retry 1, retry 2


def _backoff_delay(attempt: int) -> float:
    """Seconds to wait before the retry that follows ``attempt`` (0-based).

    Decoupled from _MAX_RETRIES on purpose: clamps to the last defined backoff
    (and 0.0 if none) so changing the retry count can never raise IndexError.
    """
    if not _RETRY_BACKOFF:
        return 0.0
    return _RETRY_BACKOFF[min(attempt, len(_RETRY_BACKOFF) - 1)]

# Canonical column roles the deterministic parser understands. Kept in sync with
# the kinds returned by ``SourcingService._classify_header_word``.
_VALID_ROLES = {"ref", "name", "qty", "unit_price", "total", "discount", "vat", "uom", "other"}

# Shared response schema for the page→date harvesting (used both inside the Tier 3
# extraction call and by the standalone date-only pass).
_PAGE_DATES_SCHEMA = {
    "type": "array",
    "items": {
        "type": "object",
        "properties": {
            "page": {"type": "number"},
            "date": {"type": "string"},
        },
        "required": ["page", "date"],
    },
}


class PdfAiUnavailable(Exception):
    """AI is disabled, unconfigured, or the request failed — caller should fall back."""


# ----------------------------------------------------------------------------
# Public surface
# ----------------------------------------------------------------------------

def is_enabled() -> bool:
    """True only when the AI tiers are switched on AND a key is configured."""
    return bool(getattr(settings, "PDF_AI_ENABLED", False) and (settings.GEMINI_API_KEY or "").strip())


def request_layout_profile(page_text: str) -> Dict:
    """
    Tier 2 — ask Gemini to describe the line-item table structure (no row data).

    Returns a dict:
      {
        "header_labels": [{"text": "UNIT PRICE", "role": "unit_price"}, ...],
        "row_start_regex": "^GDA[A-Z0-9]+",   # or "" if none
        "drop_regexes": ["^Batch Code", "Operazione Non imponibile", ...],
        "combined_identity": true   # ref + name share one column (no separate name col)
      }

    Raises PdfAiUnavailable on any problem.
    """
    if not is_enabled():
        raise PdfAiUnavailable("AI disabled or no GEMINI_API_KEY configured")
    if not (page_text or "").strip():
        raise PdfAiUnavailable("empty page text")

    prompt = (
        "You are analysing one page of a supplier invoice / price list to help a "
        "deterministic parser read its product line-item table.\n"
        "Return ONLY the structure of the table — do NOT extract the rows.\n\n"
        "Identify:\n"
        "1. header_labels: the column header phrases EXACTLY as they appear, each tagged "
        "with its role. Roles: 'ref' (supplier code/SKU/item no.), 'name' (product "
        "description), 'qty' (quantity), 'unit_price' (price PER UNIT — never the line "
        "total), 'total' (line/extended amount), 'discount', 'vat'/'tax', 'uom' "
        "(unit of measure), or 'other'. It is critical to distinguish unit_price from total.\n"
        "2. combined_identity: true if the supplier code and the product name share ONE "
        "column (no separate description column), false otherwise.\n"
        "3. row_start_regex: a Python regex (anchored with ^) matching the FIRST token of "
        "a line that begins a new product row (usually the supplier code pattern), or '' "
        "if rows cannot be told apart that way.\n"
        "4. drop_regexes: Python regex fragments matching sub-lines that are NOT products "
        "and must be ignored (batch/lot/expiry lines, totals, tax/legal notes, addresses, "
        "payment terms). Keep this list short and specific.\n\n"
        "Here is the page text:\n\n" + page_text[:12000]
    )

    schema = {
        "type": "object",
        "properties": {
            "header_labels": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "text": {"type": "string"},
                        "role": {"type": "string"},
                    },
                    "required": ["text", "role"],
                },
            },
            "combined_identity": {"type": "boolean"},
            "row_start_regex": {"type": "string"},
            "drop_regexes": {"type": "array", "items": {"type": "string"}},
        },
        "required": ["header_labels"],
    }

    data = _generate(parts=[{"text": prompt}], schema=schema)
    return _sanitise_profile(data)


def identify_supplier(page_text: str, candidates: List[Dict]) -> Dict:
    """
    Text-only call — read the SUPPLIER/VENDOR issuing a price list / invoice and,
    where possible, match it to one of the caller's known suppliers.

    ``candidates`` is a list of ``{"code": ..., "name": ...}`` for the existing
    suppliers. The model returns the code of the one it matches (or '' for none),
    so the caller resolves the id from its own authoritative list and never trusts
    a model-invented id.

    Returns a dict:
      {"detected_name": "ACME Foods Ltd", "matched_code": "ACME", "confidence": 0.0-1.0}

    Raises PdfAiUnavailable on any problem (caller falls back to manual selection).
    """
    if not is_enabled():
        raise PdfAiUnavailable("AI disabled or no GEMINI_API_KEY configured")
    if not (page_text or "").strip():
        raise PdfAiUnavailable("empty page text")

    known_lines = "\n".join(
        f"- {str(c.get('code', '')).strip()}: {str(c.get('name', '')).strip()}"
        for c in (candidates or [])
        if str(c.get('code', '')).strip()
    ) or "(no known suppliers)"

    prompt = (
        "You are reading the first page of a supplier price list / invoice / quotation.\n"
        "Identify the SUPPLIER (the vendor / seller ISSUING the document — the company "
        "whose products and prices are listed). This is NOT the customer / buyer / "
        "'bill to' / 'ship to' party, which you must ignore.\n\n"
        "Then decide whether that supplier is one of these KNOWN suppliers "
        "(format 'CODE: Name'):\n"
        f"{known_lines}\n\n"
        "Return:\n"
        "- detected_name: the supplier's name exactly as printed on the document "
        "(empty string if you genuinely cannot tell).\n"
        "- matched_code: the CODE of the known supplier it clearly is, or '' if it does "
        "not confidently match any known supplier (a different legal entity, a new "
        "supplier, or you are unsure). Match on the company identity, tolerating minor "
        "spelling/suffix differences (Ltd, GmbH, S.r.l.).\n"
        "- confidence: 0.0-1.0, how sure you are of detected_name.\n\n"
        "Document text:\n\n" + page_text[:8000]
    )

    schema = {
        "type": "object",
        "properties": {
            "detected_name": {"type": "string"},
            "matched_code": {"type": "string"},
            "confidence": {"type": "number"},
        },
        "required": ["detected_name"],
    }

    data = _generate(parts=[{"text": prompt}], schema=schema)
    conf = data.get("confidence")
    try:
        conf = max(0.0, min(1.0, float(conf)))
    except (TypeError, ValueError):
        conf = 0.0
    return {
        "detected_name": str(data.get("detected_name", "") or "").strip(),
        "matched_code": str(data.get("matched_code", "") or "").strip(),
        "confidence": conf,
    }


def extract_line_items(pdf_bytes: bytes) -> Tuple[List[Dict], Dict[int, str]]:
    """
    Tier 3 — hand the whole PDF to Gemini and get normalised line items back.

    Returns ``(items, page_dates)``:
      - ``items``: list of dicts in the importer's canonical shape, plus optional
        extras kept for verification/future use (not used by matrix/mapping):
          {ref, identifier, price, currency, page?,
           qty?, uom?, pack?, line_total?, batch?, foc?}
      - ``page_dates``: ``{page_number: 'YYYY-MM-DD'}`` for pages that carry a
        document date — harvested in this same call so we never pay for a second
        request just to date the prices.

    Raises PdfAiUnavailable on any problem.
    """
    if not is_enabled():
        raise PdfAiUnavailable("AI disabled or no GEMINI_API_KEY configured")
    if not pdf_bytes:
        raise PdfAiUnavailable("empty pdf")

    prompt = (
        "Extract every PRODUCT line item from this supplier invoice / price list.\n\n"
        "Rules:\n"
        "- 'price' MUST be the UNIT price (price per single unit), NEVER the line total "
        "or extended amount. If only a line total and a quantity are shown, divide to get "
        "the unit price.\n"
        "- 'ref' is the supplier's product code/SKU/item number (empty string if none).\n"
        "- 'identifier' is the product name/description only — exclude codes, batch/lot "
        "numbers, quantities and packaging counts that are separate columns.\n"
        "- 'currency' is the ISO code (GBP, EUR, USD, …); infer from the symbol or document.\n"
        "- 'page' is the 1-based page number the line item appears on.\n"
        "- Set 'foc' true for free-of-charge / promotional / bonus rows (price 0).\n"
        "- IGNORE non-product lines: batch/lot/expiry rows, subtotals, totals, taxes/VAT, "
        "shipping, legal text, addresses, payment terms, bank details.\n"
        "- Prices use a dot decimal separator in the output (e.g. 62.00), regardless of "
        "how they appear in the document.\n"
        "Also return 'page_dates': for each page that prints a document date (invoice "
        "date, quote/offer date, price-list date, or 'valid from' date), one entry with "
        "the 1-based 'page' and that 'date' normalised to YYYY-MM-DD. The file may be "
        "several documents merged together, so different pages can carry different dates; "
        "omit pages that show no date.\n"
        "Return numbers as JSON numbers, not strings."
    )

    schema = {
        "type": "object",
        "properties": {
            "items": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "ref": {"type": "string"},
                        "identifier": {"type": "string"},
                        "price": {"type": "number"},
                        "currency": {"type": "string"},
                        "page": {"type": "number"},
                        "qty": {"type": "number"},
                        "uom": {"type": "string"},
                        "pack": {"type": "string"},
                        "line_total": {"type": "number"},
                        "batch": {"type": "string"},
                        "foc": {"type": "boolean"},
                    },
                    "required": ["identifier", "price"],
                },
            },
            "page_dates": _PAGE_DATES_SCHEMA,
        },
        "required": ["items"],
    }

    b64 = base64.b64encode(pdf_bytes).decode("ascii")
    parts = [
        {"text": prompt},
        {"inline_data": {"mime_type": "application/pdf", "data": b64}},
    ]
    data = _generate(parts=parts, schema=schema, timeout=180.0)
    return _sanitise_items(data.get("items") or []), _sanitise_page_dates(data.get("page_dates"))


def extract_page_dates(pdf_bytes: bytes) -> Dict[int, str]:
    """
    Lightweight date-only pass — used when a deterministic/layout parse already
    produced the line items (so no whole-PDF AI call happened) but a price
    conflict still needs dating. Returns ``{page_number: 'YYYY-MM-DD'}`` for pages
    that carry a document date.

    Raises PdfAiUnavailable on any problem.
    """
    if not is_enabled():
        raise PdfAiUnavailable("AI disabled or no GEMINI_API_KEY configured")
    if not pdf_bytes:
        raise PdfAiUnavailable("empty pdf")

    prompt = (
        "Look only for DOCUMENT DATES in this supplier invoice / price list — do not "
        "extract products.\n"
        "For each page that prints a document date (invoice date, quote/offer date, "
        "price-list date, or 'valid from' date), return one 'page_dates' entry with the "
        "1-based 'page' number and that 'date' normalised to YYYY-MM-DD.\n"
        "The file may be several documents merged together, so different pages can carry "
        "different dates. Omit any page that shows no date."
    )

    schema = {
        "type": "object",
        "properties": {"page_dates": _PAGE_DATES_SCHEMA},
        "required": ["page_dates"],
    }

    b64 = base64.b64encode(pdf_bytes).decode("ascii")
    parts = [
        {"text": prompt},
        {"inline_data": {"mime_type": "application/pdf", "data": b64}},
    ]
    data = _generate(parts=parts, schema=schema, timeout=120.0)
    return _sanitise_page_dates(data.get("page_dates"))


# ----------------------------------------------------------------------------
# Internals
# ----------------------------------------------------------------------------

def _generate(parts: List[Dict], schema: Dict, timeout: float = 60.0) -> Dict:
    """POST to Gemini generateContent and return the parsed JSON object.

    Retries a bounded number of times on TRANSIENT failures only (rate limit,
    server-side 5xx, network errors). A 4xx or a malformed 200 fails immediately
    so we never loop on a request that can't succeed — see _MAX_RETRIES.
    """
    import json

    model = (settings.GEMINI_MODEL or "gemini-2.5-flash").strip()
    url = f"{_API_ROOT}/{model}:generateContent"
    body = {
        "contents": [{"role": "user", "parts": parts}],
        "generationConfig": {
            "temperature": 0,
            "responseMimeType": "application/json",
            "responseSchema": schema,
        },
    }

    for attempt in range(_MAX_RETRIES + 1):
        try:
            resp = httpx.post(
                url,
                params={"key": settings.GEMINI_API_KEY},
                json=body,
                timeout=timeout,
            )
        except httpx.HTTPError as e:
            # Network/timeout error — transient, retry if attempts remain.
            if attempt < _MAX_RETRIES:
                logger.info(f"Gemini request error (attempt {attempt + 1}), retrying: {e}")
                time.sleep(_backoff_delay(attempt))
                continue
            raise PdfAiUnavailable(f"Gemini request failed: {e}") from e

        if resp.status_code != 200:
            # Retry only transient server-side / rate-limit statuses; a 4xx means
            # the request itself won't ever succeed, so fail fast.
            if resp.status_code in _RETRY_STATUSES and attempt < _MAX_RETRIES:
                logger.info(
                    f"Gemini HTTP {resp.status_code} (attempt {attempt + 1}), retrying"
                )
                time.sleep(_backoff_delay(attempt))
                continue
            raise PdfAiUnavailable(f"Gemini HTTP {resp.status_code}: {resp.text[:300]}")

        try:
            payload = resp.json()
            text = payload["candidates"][0]["content"]["parts"][0]["text"]
            return json.loads(text)
        except (KeyError, IndexError, ValueError, TypeError) as e:
            # A 200 already cost tokens; don't retry a malformed body.
            raise PdfAiUnavailable(f"Unexpected Gemini response: {e}") from e

    # Unreachable: the loop always returns or raises on its final attempt.
    raise PdfAiUnavailable("Gemini retries exhausted")


def _sanitise_profile(data: Dict) -> Dict:
    labels = []
    for lab in (data.get("header_labels") or []):
        text = str(lab.get("text", "")).strip()
        role = str(lab.get("role", "other")).strip().lower()
        if role == "tax":
            role = "vat"
        if role not in _VALID_ROLES:
            role = "other"
        if text:
            labels.append({"text": text, "role": role})
    if not labels:
        raise PdfAiUnavailable("layout profile had no usable header labels")
    return {
        "header_labels": labels,
        "combined_identity": bool(data.get("combined_identity", False)),
        "row_start_regex": str(data.get("row_start_regex", "") or "").strip(),
        "drop_regexes": [str(r).strip() for r in (data.get("drop_regexes") or []) if str(r).strip()],
    }


def _coerce_price(value) -> Optional[float]:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    s = str(value).strip()
    if not s:
        return None
    # Defensive: the model is told to emit dot-decimals, but tolerate "1.234,56"
    # / "1 234,56" just in case.
    for ch in ('\u00a3', '\u20ac', '$', '\u00a5', ' ', '\u00a0', '\u202f'):
        s = s.replace(ch, '')
    if "," in s and "." in s:
        s = s.replace(".", "").replace(",", ".")
    elif "," in s:
        s = s.replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return None


def _sanitise_items(raw: List[Dict]) -> List[Dict]:
    items: List[Dict] = []
    for it in raw:
        if not isinstance(it, dict):
            continue
        price = _coerce_price(it.get("price"))
        identifier = str(it.get("identifier", "") or "").strip()
        ref = str(it.get("ref", "") or "").strip()
        if price is None or not (ref or identifier):
            continue
        currency = str(it.get("currency", "") or "").strip().upper() or None
        item = {"ref": ref, "identifier": identifier, "price": price, "currency": currency}
        # 1-based page the line came from — used to date its price (see service.py).
        page = _coerce_page(it.get("page"))
        if page is not None:
            item["page"] = page
        # Optional extras — preserved for verification/future use only.
        for k in ("qty", "uom", "pack", "line_total", "batch", "foc"):
            if it.get(k) not in (None, ""):
                item[k] = it[k]
        items.append(item)
    return items


def _coerce_page(value) -> Optional[int]:
    """Best-effort 1-based page number from a model value; None if not usable."""
    if value is None:
        return None
    try:
        page = int(float(value))
    except (TypeError, ValueError):
        return None
    return page if page >= 1 else None


def _sanitise_page_dates(raw) -> Dict[int, str]:
    """Turn the model's ``[{page, date}]`` array into ``{page: 'YYYY-MM-DD'}``.

    Keeps only entries with a usable 1-based page and a non-empty date string. If
    the same page appears twice, the first non-empty date wins. Never raises.
    """
    result: Dict[int, str] = {}
    if not isinstance(raw, list):
        return result
    for entry in raw:
        if not isinstance(entry, dict):
            continue
        page = _coerce_page(entry.get("page"))
        date = str(entry.get("date", "") or "").strip()
        if page is None or not date:
            continue
        result.setdefault(page, date)
    return result
