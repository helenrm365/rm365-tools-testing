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
    that hands Gemini the raw PDF and gets structured line items back. Used only
    when the deterministic passes (with or without a layout profile) still fail.

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
from typing import Dict, List, Optional

import httpx

from core.config import settings

logger = logging.getLogger(__name__)

_API_ROOT = "https://generativelanguage.googleapis.com/v1beta/models"

# Canonical column roles the deterministic parser understands. Kept in sync with
# the kinds returned by ``SourcingService._classify_header_word``.
_VALID_ROLES = {"ref", "name", "qty", "unit_price", "total", "discount", "vat", "uom", "other"}


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


def extract_line_items(pdf_bytes: bytes) -> List[Dict]:
    """
    Tier 3 — hand the whole PDF to Gemini and get normalised line items back.

    Returns a list of dicts in the importer's canonical shape, plus optional
    extras kept for verification/future use (not used by matrix/mapping):
      {ref, identifier, price, currency,
       qty?, uom?, pack?, line_total?, batch?, foc?}

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
        "- Set 'foc' true for free-of-charge / promotional / bonus rows (price 0).\n"
        "- IGNORE non-product lines: batch/lot/expiry rows, subtotals, totals, taxes/VAT, "
        "shipping, legal text, addresses, payment terms, bank details.\n"
        "- Prices use a dot decimal separator in the output (e.g. 62.00), regardless of "
        "how they appear in the document.\n"
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
                        "qty": {"type": "number"},
                        "uom": {"type": "string"},
                        "pack": {"type": "string"},
                        "line_total": {"type": "number"},
                        "batch": {"type": "string"},
                        "foc": {"type": "boolean"},
                    },
                    "required": ["identifier", "price"],
                },
            }
        },
        "required": ["items"],
    }

    b64 = base64.b64encode(pdf_bytes).decode("ascii")
    parts = [
        {"text": prompt},
        {"inline_data": {"mime_type": "application/pdf", "data": b64}},
    ]
    data = _generate(parts=parts, schema=schema, timeout=180.0)
    return _sanitise_items(data.get("items") or [])


# ----------------------------------------------------------------------------
# Internals
# ----------------------------------------------------------------------------

def _generate(parts: List[Dict], schema: Dict, timeout: float = 60.0) -> Dict:
    """POST to Gemini generateContent and return the parsed JSON object."""
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
    try:
        resp = httpx.post(
            url,
            params={"key": settings.GEMINI_API_KEY},
            json=body,
            timeout=timeout,
        )
    except httpx.HTTPError as e:
        raise PdfAiUnavailable(f"Gemini request failed: {e}") from e

    if resp.status_code != 200:
        raise PdfAiUnavailable(f"Gemini HTTP {resp.status_code}: {resp.text[:300]}")

    try:
        payload = resp.json()
        text = payload["candidates"][0]["content"]["parts"][0]["text"]
        return json.loads(text)
    except (KeyError, IndexError, ValueError, TypeError) as e:
        raise PdfAiUnavailable(f"Unexpected Gemini response: {e}") from e


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
        # Optional extras — preserved for verification/future use only.
        for k in ("qty", "uom", "pack", "line_total", "batch", "foc"):
            if it.get(k) not in (None, ""):
                item[k] = it[k]
        items.append(item)
    return items
