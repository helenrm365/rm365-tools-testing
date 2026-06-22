"""
End-to-end extraction harness for the supplier PDF importer, run against the
REAL sample invoices. This is DB-free: it exercises the extraction tiers
directly (no supplier/mapping lookups), which is exactly the part the IDP
upgrade changes.

How to run:
  1. Drop the sample PDFs into tests/fixtures/ (any filename containing the
     supplier token works), e.g.:
         tests/fixtures/GHMC Merged.pdf
         tests/fixtures/GDA Merged.pdf
         tests/fixtures/MED & SKIN Pharma Merged.pdf
         tests/fixtures/YSkin Merged.pdf
  2. (Optional) export GEMINI_API_KEY=... to exercise the AI tiers on GDA.
  3. .venv/bin/python -m pytest tests/test_pdf_idp_fixtures.py -v -s

Without the fixtures the tests skip, so CI stays green.
"""
import os
import sys
import glob
import importlib

import pytest

BACKEND = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "backend")
if BACKEND not in sys.path:
    sys.path.insert(0, BACKEND)

FIX_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures")

from modules.inventory.sourcing.service import SourcingService  # noqa: E402
pdf_ai = importlib.import_module("modules.inventory.sourcing.pdf_ai")

try:
    import pdfplumber  # noqa: F401
    _HAVE_PDFPLUMBER = True
except Exception:
    _HAVE_PDFPLUMBER = False


def _find(token: str):
    """Return the path of a fixture PDF whose name contains token, else None."""
    if not os.path.isdir(FIX_DIR):
        return None
    for p in glob.glob(os.path.join(FIX_DIR, "*.pdf")):
        if token.lower() in os.path.basename(p).lower():
            return p
    return None


def _deterministic_confidence(pdf_path: str):
    """Run Tier-1 extraction on a PDF and return (items, confidence)."""
    import io
    import pdfplumber
    svc = SourcingService()
    with open(pdf_path, "rb") as f:
        data = f.read()
    with pdfplumber.open(io.BytesIO(data)) as pdf:
        pages = pdf.pages
        total_pages = len(pages) or 1
        items = svc._extract_pages_deterministic(pages, "EUR", lambda *_: None, total_pages)
        conf = svc._extraction_confidence(items, total_pages)
    return items, conf


pytestmark = pytest.mark.skipif(not _HAVE_PDFPLUMBER, reason="pdfplumber not installed")


@pytest.mark.parametrize("token", ["GHMC", "MED", "YSkin"])
def test_clean_layouts_parse_via_tier1(token):
    """Clean single-header layouts should parse deterministically (no AI needed)."""
    path = _find(token)
    if not path:
        pytest.skip(f"fixture for {token} not present in {FIX_DIR}")
    items, conf = _deterministic_confidence(path)
    print(f"\n{token}: {len(items)} items, confidence={conf}")
    assert items, f"{token}: deterministic tier extracted nothing"
    assert conf >= 0.80, f"{token}: confidence {conf} unexpectedly low for a clean layout"


def test_gda_complex_layout_needs_escalation_or_ai():
    """
    GDA's combined item/description column + interleaved batch rows is the case
    the deterministic parser struggles with. Either Tier 1 is low-confidence
    (so the importer WOULD escalate), or — when a key is configured — the AI
    direct tier returns the correct UNIT prices (62.00, not the 15500.00 total).
    """
    path = _find("GDA")
    if not path:
        pytest.skip(f"fixture for GDA not present in {FIX_DIR}")

    items, conf = _deterministic_confidence(path)
    print(f"\nGDA deterministic: {len(items)} items, confidence={conf}")

    if not pdf_ai.is_enabled():
        # No key: we only assert that the importer would escalate (low confidence),
        # which is the trigger for the AI tiers in import_matrix_pdf.
        assert conf < 0.80, (
            "GDA scored high deterministically; if that's genuinely correct, great — "
            "otherwise the escalation gate needs revisiting."
        )
        pytest.skip("GEMINI_API_KEY not set — skipping AI extraction assertions")

    with open(path, "rb") as f:
        data = f.read()
    ai_items = pdf_ai.extract_line_items(data)
    print(f"GDA AI direct: {len(ai_items)} items")
    refs = {it.get("ref", "").upper() for it in ai_items}
    assert "GDABR0040" in refs, "AI extraction missed the PLURYAL DENSIFY line"
    densify = next(it for it in ai_items if it.get("ref", "").upper() == "GDABR0040")
    # Unit price, NOT the 15 500,00 line total.
    assert abs(float(densify["price"]) - 62.0) < 0.5, f"expected unit price ~62.00, got {densify['price']}"
    # Batch/total rows must never appear as products.
    joined = " ".join((it.get("identifier") or "") for it in ai_items).lower()
    assert "operazione non imponibile" not in joined
    assert "batch code" not in joined
