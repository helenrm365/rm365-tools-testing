"""
Unit tests for the Intelligent Document Processing (IDP) upgrade to the supplier
PDF importer.

These cover the dependency-free logic — AI response sanitisation/coercion, the
extraction-confidence scorer, and the graceful-degradation gate — without needing
a database, network, or real PDFs. End-to-end extraction on the real sample PDFs
(GHMC / GDA / MED&SKIN / YSkin) is exercised separately by dropping those files
into tests/fixtures/ and running test_pdf_idp_fixtures (see bottom of file).
"""
import sys
import os
import importlib

import pytest

BACKEND = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "backend")
if BACKEND not in sys.path:
    sys.path.insert(0, BACKEND)

pdf_ai = importlib.import_module("modules.inventory.sourcing.pdf_ai")
from modules.inventory.sourcing.service import SourcingService  # noqa: E402


# ---------------------------------------------------------------------------
# pdf_ai: price coercion
# ---------------------------------------------------------------------------
@pytest.mark.parametrize("raw,expected", [
    (62, 62.0),
    (62.0, 62.0),
    ("62.00", 62.0),
    ("62,00", 62.0),            # European decimal comma
    ("1.234,56", 1234.56),      # European thousands + decimal
    ("1 234,56", 1234.56),      # space thousands
    ("€ 62,00", 62.0),          # stray currency symbol
    ("", None),
    (None, None),
    ("abc", None),
])
def test_coerce_price(raw, expected):
    assert pdf_ai._coerce_price(raw) == expected


# ---------------------------------------------------------------------------
# pdf_ai: item sanitisation
# ---------------------------------------------------------------------------
def test_sanitise_items_filters_and_normalises():
    raw = [
        {"ref": "GDABR0040", "identifier": "PLURYAL DENSIFY", "price": 62.0, "currency": "eur",
         "qty": 250, "line_total": 15500.0, "batch": "2602726A"},
        {"identifier": "No price row", "price": None},          # dropped (no price)
        {"ref": "", "identifier": "", "price": 5.0},            # dropped (no ref/name)
        {"identifier": "Stylage", "price": "43,00"},            # string price coerced
        "not-a-dict",                                            # ignored
    ]
    items = pdf_ai._sanitise_items(raw)
    assert len(items) == 2
    first = items[0]
    assert first["ref"] == "GDABR0040"
    assert first["price"] == 62.0
    assert first["currency"] == "EUR"               # upper-cased
    # extras preserved for verification/future use
    assert first["qty"] == 250 and first["batch"] == "2602726A" and first["line_total"] == 15500.0
    assert items[1]["price"] == 43.0 and items[1]["currency"] is None


# ---------------------------------------------------------------------------
# pdf_ai: layout-profile sanitisation
# ---------------------------------------------------------------------------
def test_sanitise_profile_maps_roles():
    prof = pdf_ai._sanitise_profile({
        "header_labels": [
            {"text": "ITEM", "role": "ref"},
            {"text": "UNIT PRICE", "role": "unit_price"},
            {"text": "VAT", "role": "tax"},        # 'tax' normalised to 'vat'
            {"text": "JUNK", "role": "nonsense"},  # unknown role → 'other'
            {"text": "", "role": "ref"},           # blank text dropped
        ],
        "combined_identity": True,
        "row_start_regex": "^GDA",
        "drop_regexes": ["^Batch Code", "  "],
    })
    roles = {l["text"]: l["role"] for l in prof["header_labels"]}
    assert roles == {"ITEM": "ref", "UNIT PRICE": "unit_price", "VAT": "vat", "JUNK": "other"}
    assert prof["combined_identity"] is True
    assert prof["row_start_regex"] == "^GDA"
    assert prof["drop_regexes"] == ["^Batch Code"]   # blank stripped


def test_sanitise_profile_requires_labels():
    with pytest.raises(pdf_ai.PdfAiUnavailable):
        pdf_ai._sanitise_profile({"header_labels": []})


# ---------------------------------------------------------------------------
# pdf_ai: graceful-degradation gate
# ---------------------------------------------------------------------------
def test_is_enabled_requires_flag_and_key(monkeypatch):
    monkeypatch.setattr(pdf_ai.settings, "PDF_AI_ENABLED", True, raising=False)
    monkeypatch.setattr(pdf_ai.settings, "GEMINI_API_KEY", "", raising=False)
    assert pdf_ai.is_enabled() is False                      # no key → disabled

    monkeypatch.setattr(pdf_ai.settings, "GEMINI_API_KEY", "k", raising=False)
    assert pdf_ai.is_enabled() is True

    monkeypatch.setattr(pdf_ai.settings, "PDF_AI_ENABLED", False, raising=False)
    assert pdf_ai.is_enabled() is False                      # flag off → disabled


def test_public_calls_raise_when_disabled(monkeypatch):
    monkeypatch.setattr(pdf_ai.settings, "PDF_AI_ENABLED", False, raising=False)
    with pytest.raises(pdf_ai.PdfAiUnavailable):
        pdf_ai.request_layout_profile("ITEM UNIT PRICE")
    with pytest.raises(pdf_ai.PdfAiUnavailable):
        pdf_ai.extract_line_items(b"%PDF-1.4 ...")


# ---------------------------------------------------------------------------
# service: extraction-confidence scorer (drives tier escalation)
# ---------------------------------------------------------------------------
def _svc():
    return SourcingService()


def test_confidence_empty_is_zero():
    assert _svc()._extraction_confidence([], total_pages=1) == 0.0


def test_confidence_clean_extraction_scores_high():
    svc = _svc()
    items = [
        {"ref": f"U{i}0", "identifier": f"Stylage BI SOFT variant {i}", "price": 40.0 + i, "currency": "GBP"}
        for i in range(8)
    ]
    assert svc._extraction_confidence(items, total_pages=1) >= 0.80


def test_confidence_noisy_extraction_scores_low():
    svc = _svc()
    # Footer/admin noise + missing prices → should fall below the escalation gate.
    items = [
        {"ref": "", "identifier": "Net à payer", "price": None},
        {"ref": "", "identifier": "IBAN FR7610278060410002103480162", "price": None},
        {"ref": "", "identifier": "TVA 0,00", "price": None},
    ]
    assert svc._extraction_confidence(items, total_pages=3) < 0.80


def test_confidence_sparse_extraction_scores_low():
    svc = _svc()
    # One usable row pulled from a dense 5-page document → low volume → escalate.
    items = [{"ref": "U332", "identifier": "Stylage BI SOFT Hydromax", "price": 43.0, "currency": "GBP"}]
    assert svc._extraction_confidence(items, total_pages=5) < 0.80


# ---------------------------------------------------------------------------
# service: plausibility filter still rejects footer/artifact noise
# ---------------------------------------------------------------------------
def test_plausible_identifier_rejects_footer_and_artifacts():
    svc = _svc()
    assert svc._is_plausible_identifier("U332", "Stylage BI SOFT - Hydromax") is True
    assert svc._is_plausible_identifier("", "Net à payer") is False          # footer
    assert svc._is_plausible_identifier("", "SSttyyllaaggee BBII") is False   # doubling artifact
    assert svc._is_plausible_identifier("", "ab") is False                    # too short


# ---------------------------------------------------------------------------
# service: in-table service/charge rows are not products
# ---------------------------------------------------------------------------
def test_service_charge_rows_rejected():
    svc = _svc()
    # Real rows from a Nordic Medical Solutions invoice: printed in the item
    # table with a code, a qty and a unit price, but they are costs, not goods.
    assert svc._looks_like_service_charge("INSURANCE", "Insurance") is True
    assert svc._looks_like_service_charge("COURIER", "Courier") is True
    assert svc._looks_like_service_charge("", "Shipping & Handling") is True
    assert svc._looks_like_service_charge("", "Delivery charge") is True
    assert svc._looks_like_service_charge("", "Frais de port") is True
    assert svc._looks_like_service_charge("", "Spese di spedizione") is True
    assert svc._looks_like_service_charge("", "Versandkosten") is True
    assert svc._looks_like_service_charge("", "CCoouurriieerr") is True  # doubled artifact


def test_service_charge_filter_keeps_real_products():
    svc = _svc()
    assert svc._looks_like_service_charge("A5200", "Stylage Bi-Soft Hydro 1ml") is False
    assert svc._looks_like_service_charge("A5225", "Stylage Bi-Soft Lips Plus Lidocaine 1ml") is False
    # Products whose names merely contain a charge word must survive.
    assert svc._looks_like_service_charge("TK100", "Transport Box") is False
    assert svc._looks_like_service_charge("DC22", "Delivery Cannula 22G") is False
    assert svc._looks_like_service_charge("SVC1", "Service Kit") is False
    assert svc._looks_like_service_charge("", "") is False
