"""
Unit tests for the Intelligent Document Processing (IDP) upgrade to the supplier
PDF importer.

These cover the dependency-free logic — AI response sanitisation/coercion, the
extraction-confidence scorer, and the graceful-degradation gate — without needing
a database, network, or real PDFs. End-to-end extraction on the real sample PDFs
(GHMC / GDA / MED&SKIN / YSkin) is exercised separately by dropping those files
into tests/fixtures/ and running test_pdf_idp_fixtures (see bottom of file).
"""
import io
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
    with pytest.raises(pdf_ai.PdfAiUnavailable):
        pdf_ai.identify_suppliers_from_images([{"image_png": b"\x89PNG"}], [])


def test_identify_from_images_rejects_unrenderable_docs(monkeypatch):
    """A doc with no rendered image would silently shift every LATER document's
    number, mis-attributing suppliers — fail instead so the caller falls back."""
    monkeypatch.setattr(pdf_ai.settings, "PDF_AI_ENABLED", True, raising=False)
    monkeypatch.setattr(pdf_ai.settings, "GEMINI_API_KEY", "k", raising=False)
    with pytest.raises(pdf_ai.PdfAiUnavailable):
        pdf_ai.identify_suppliers_from_images([], [])
    with pytest.raises(pdf_ai.PdfAiUnavailable):
        pdf_ai.identify_suppliers_from_images(
            [{"image_png": b"\x89PNG"}, {"image_png": None}], [])


# ---------------------------------------------------------------------------
# service: detection image budget
#
# The model bills images by 768px tiles, so the letterhead render is sized to a
# fixed tile budget rather than a fixed DPI. Getting this wrong is invisible —
# detection still works, it just quietly costs more per document — so pin it.
# ---------------------------------------------------------------------------
def _one_page_pdf(pagesize):
    reportlab = pytest.importorskip("reportlab")  # noqa: F841
    from reportlab.pdfgen import canvas
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=pagesize)
    c.drawString(50, pagesize[1] - 60, "MED & SKIN")
    c.drawString(pagesize[0] * 0.55, pagesize[1] - 60, "Reliable Medicare LTD")
    c.showPage()
    c.save()
    return buf.getvalue()


@pytest.mark.parametrize("pagesize", [
    (595.28, 841.89),   # A4 portrait
    (612.0, 792.0),     # US Letter
    (841.89, 595.28),   # A4 landscape — a fixed scale would cost an extra tile
    (283.46, 419.53),   # A6 — small page, must not upscale into more tiles
])
def test_letterhead_render_stays_within_tile_budget(pagesize):
    pytest.importorskip("PIL")
    from PIL import Image
    from modules.inventory.sourcing.service import (
        _render_first_pages, _TILE_PX, _BAND_TILE_BUDGET,
    )

    docs, index_map = _render_first_pages([(0, _one_page_pdf(pagesize))])
    assert index_map == [0]
    with Image.open(io.BytesIO(docs[0]["image_png"])) as img:
        width, height = img.size
    tiles_across = -(-width // _TILE_PX)
    tiles_down = -(-height // _TILE_PX)
    assert tiles_across * tiles_down <= _BAND_TILE_BUDGET, (
        f"{width}x{height}px costs {tiles_across * tiles_down} tiles"
    )


def test_render_skips_unusable_files_without_raising():
    from modules.inventory.sourcing.service import _render_first_pages
    docs, index_map = _render_first_pages([(0, b""), (1, b"not a pdf"), (2, None)])
    assert docs == [] and index_map == []


# ---------------------------------------------------------------------------
# service: company-name comparison (drives the buyer cross-check)
# ---------------------------------------------------------------------------
from modules.inventory.sourcing.service import _same_company  # noqa: E402


@pytest.mark.parametrize("a,b", [
    ("Reliable Medicare LTD", "Reliable Medicare"),        # legal suffix dropped
    ("MED & SKIN SPRL", "Med and Skin"),                   # &/and + suffix
    ("med-skin.be", "Med Skin"),                           # punctuation
    ("Nordic Medical Solutions Ltd", "NORDIC MEDICAL SOLUTIONS"),
    ("Reliable Medicare", "Reliable Medicare Pharmacy"),   # containment
])
def test_same_company_matches_variants(a, b):
    assert _same_company(a, b) is True


@pytest.mark.parametrize("a,b", [
    ("Med & Skin", "Reliable Medicare LTD"),               # the real-world case
    ("GDA Srl", "GHMC"),
    ("Nordic Medical Solutions", "Iberian Medical Supplies"),
    ("Pharma Group Ltd", "Medica Group Ltd"),              # one shared word only
    ("Med & Skin", ""),                                    # nothing to compare
    ("", ""),
    ("Ltd", "Ltd"),                                        # suffixes only → no tokens
])
def test_same_company_rejects_different_firms(a, b):
    assert _same_company(a, b) is False


# ---------------------------------------------------------------------------
# service: extraction-confidence scorer (drives tier escalation)
# ---------------------------------------------------------------------------
def _svc():
    return SourcingService()


# ---------------------------------------------------------------------------
# service: supplier-detection guards (buyer cross-check + confidence gate)
# ---------------------------------------------------------------------------
_KNOWN = {"ms": {"id": 7, "name": "Med & Skin Pharma"}}


def _detect(result):
    """Run one model answer through the guards and return the resulting entry."""
    from modules.inventory.sourcing.service import _IDENTIFY_EMPTY
    entry = dict(_IDENTIFY_EMPTY)
    _svc()._apply_supplier_detection(entry, result, _KNOWN)
    return entry


def test_detection_auto_selects_confident_match():
    entry = _detect({"detected_name": "MED & SKIN SPRL", "buyer_name": "Reliable Medicare LTD",
                     "matched_code": "MS", "confidence": 0.93})
    assert entry["matched_supplier_id"] == 7
    assert entry["suggested_supplier_id"] is None
    assert entry["detected_name"] == "MED & SKIN SPRL"


def test_detection_downgrades_low_confidence_match_to_suggestion():
    """A weak letterhead read must never import against a supplier unasked."""
    entry = _detect({"detected_name": "MED & SKIN SPRL", "buyer_name": "Reliable Medicare LTD",
                     "matched_code": "MS", "confidence": 0.4})
    assert entry["matched_supplier_id"] is None
    assert entry["suggested_supplier_id"] == 7
    assert entry["suggested_supplier_name"] == "Med & Skin Pharma"


def test_detection_discarded_when_supplier_equals_buyer():
    """The real failure: the model answers with the addressee (whose name is the
    only company in the text layer) instead of the letterhead's owner."""
    entry = _detect({"detected_name": "Reliable Medicare LTD", "buyer_name": "Reliable Medicare",
                     "matched_code": "", "confidence": 0.9})
    assert entry["detected_name"] is None          # not offered as a new supplier
    assert entry["matched_supplier_id"] is None
    assert entry["suggested_supplier_id"] is None
    assert entry["confidence"] == 0.0


def test_detection_keeps_unknown_supplier_for_the_create_prompt():
    """An unknown supplier that ISN'T the buyer still steers the user to create it."""
    entry = _detect({"detected_name": "New Aesthetics GmbH", "buyer_name": "Reliable Medicare LTD",
                     "matched_code": "", "confidence": 0.88})
    assert entry["detected_name"] == "New Aesthetics GmbH"
    assert entry["matched_supplier_id"] is None and entry["suggested_supplier_id"] is None


def test_detection_tolerates_missing_fields():
    entry = _detect({})
    assert entry["detected_name"] is None and entry["confidence"] == 0.0
    # An unknown code can't match anything, confidence notwithstanding.
    assert _detect({"detected_name": "X Ltd", "matched_code": "zz",
                    "confidence": 1.0})["matched_supplier_id"] is None


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


# ---------------------------------------------------------------------------
# service: deterministic document-date scanning
#
# These strings are the real header lines of each supplier's layout. Reading the
# date from text keeps the AI date pass (a whole-PDF vision call) off the hot
# path — it used to fire for EVERY price conflict and stall the import for
# 18-30s behind a "Matching products…" message.
# ---------------------------------------------------------------------------
@pytest.mark.parametrize("text,expected", [
    # MED & SKIN — French month abbreviations
    ("FACTURE N° 2025-00000001622 26 déc. 2025", "2025-12-26"),
    ("BON DE COMMANDE N° 2026-00000000584 16 avr. 2026", "2026-04-16"),
    ("BON DE COMMANDE N° 2026-00000000393 10 mars 2026", "2026-03-10"),
    ("FACTURE N° 2026-00000000209 15 févr. 2026", "2026-02-15"),
    # GDA — Italian "del", day-first numeric
    ("n. 1/963 del 08/06/2026 Pagina 1", "2026-06-08"),
    # GHMC — bold rendered as doubled characters
    ("DDaattee dd''éémmiissssiioonn :: 15/10/2025 - (NF525) C0475", "2025-10-15"),
    # Nordic — two-digit year, day-first
    ("Birmingham, B3 3BY United Kingdom Date: 25-06-26", "2026-06-25"),
    # YSkin — unlabelled date in the header row; the FIRST is the document date,
    # the second is the payment due date.
    ("FA20250053 12/07/2025 CL00002 20/08/2025 Virement 30 jours", "2025-07-12"),
    # Hong Kong invoice — ISO with single-digit month/day
    ("Date:\n2026-2-27 Payment Method:", "2026-02-27"),
    # English long form
    ("Invoice date: April 16, 2026", "2026-04-16"),
    ("", None),
    ("No date printed anywhere on this page", None),
])
def test_scan_page_date(text, expected):
    assert SourcingService._scan_page_date(text) == expected


def test_scan_page_date_ignores_batch_and_expiry_dates():
    """Expiry/lot dates sit inside the item table and must never win."""
    svc = SourcingService
    # MED & SKIN prints an ISO expiry per line; the document date is the header.
    text = (
        "FACTURE N° 2025-00000001622 26 déc. 2025\n"
        "1 BE005028 WiQ Eye Contour 008324 2028-05-31 5,00 Pc 0% 22,00\n"
        "4 BE005057 PRX PLUS Gel 0076525 2028-03-05 10,00 pc 0% 145,00\n"
    )
    assert svc._scan_page_date(text) == "2025-12-26"
    # With no document date at all, an expiry line must still not be used.
    assert svc._scan_page_date("Batch Code26015A Batch Expiry 23/02/2028") is None
    assert svc._scan_page_date("Lot no.: 253182102 Exp. date: 19-04-2028 Qty.: 43") is None


def test_build_date_rejects_impossible_dates():
    svc = SourcingService
    assert svc._build_date(2026, 2, 30) is None   # no 30th of February
    assert svc._build_date(2026, 13, 1) is None   # no month 13
    assert svc._build_date(1850, 1, 1) is None    # out of plausible range
    assert svc._build_date(26, 6, 25) == "2026-06-25"  # 2-digit year expands


def test_effective_page_dates_carries_forward():
    """A merged file dates each document on its first page; later pages inherit."""
    svc = SourcingService
    eff = svc._effective_page_dates({2: "2026-05-13", 5: "2026-05-18"}, 6)
    assert eff.get(1) is None          # before the first dated page → N/A
    assert eff[2] == "2026-05-13"
    assert eff[4] == "2026-05-13"      # inherits the document it belongs to
    assert eff[5] == "2026-05-18"
    assert eff[6] == "2026-05-18"


def test_looks_doubled_discriminates_artifact_from_normal_text():
    svc = SourcingService
    assert svc._looks_doubled("DDaattee dd''éémmiissssiioonn") is True
    assert svc._looks_doubled("Date d'émission : 15/10/2025") is False
    # Natural double letters must not trip it.
    assert svc._looks_doubled("Firming Anti-Drying Body Cream 200 ml.") is False
    assert svc._looks_doubled("n. 1/963 del 08/06/2026 Pagina 1") is False


def test_date_scan_does_not_dedouble_normal_numeric_dates():
    """_dedouble collapses digits too, so it must not touch un-doubled lines:
    '2022-11-05' would otherwise become '202-1-05'."""
    svc = SourcingService
    assert svc._scan_page_date("Invoice date: 2022-11-05") == "2022-11-05"
    assert svc._scan_page_date("FACTURE N° 2255 22/11/2025") == "2025-11-22"
