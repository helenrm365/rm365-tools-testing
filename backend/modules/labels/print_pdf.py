from __future__ import annotations
import io, os, tempfile, shutil
from datetime import datetime
from typing import Any
from psycopg2.extensions import connection as PGConn  # type: ignore
from fastapi.responses import StreamingResponse

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas
from barcode import Code128
from barcode.writer import ImageWriter


# ---------------------------------------------------------------------
# PDF + LABEL CONFIG
# ---------------------------------------------------------------------
# Default (UK) page config
PAGE_WIDTH_MM = 103
PAGE_HEIGHT_MM = 200
PAGE_SIZE = (PAGE_WIDTH_MM * mm, PAGE_HEIGHT_MM * mm)

LABEL_WIDTH = 69 * mm
LABEL_HEIGHT = 27 * mm
TOP_MARGIN = 11 * mm
LEFT_MARGIN = 1 * mm
ROWS_PER_PAGE = 7
COLS_PER_PAGE = 1

# Region-specific page configurations
REGION_PAGE_CONFIG = {
    'uk': {
        'page_width': 103 * mm,
        'page_height': 200 * mm,
        'label_width': 69 * mm,
        'label_height': 27 * mm,
        'top_margin': 11 * mm,
        'left_margin': 1 * mm,
        'rows_per_page': 7,
        'cols_per_page': 1,
    },
    'fr': {
        'page_width': 100 * mm,
        'page_height': 170 * mm,
        'label_width': 69 * mm,
        'label_height': 26 * mm,  # Adjusted to fit 6 labels
        'top_margin': 8 * mm,
        'left_margin': 1 * mm,
        'rows_per_page': 6,
        'cols_per_page': 1,
    },
    'nl': {
        'page_width': 100 * mm,
        'page_height': 170 * mm,
        'label_width': 69 * mm,
        'label_height': 26 * mm,  # Adjusted to fit 6 labels
        'top_margin': 8 * mm,
        'left_margin': 1 * mm,
        'rows_per_page': 6,
        'cols_per_page': 1,
    },
}


def get_page_config(region: str) -> dict:
    """Get page configuration for a region, defaulting to UK config."""
    return REGION_PAGE_CONFIG.get(region.lower(), REGION_PAGE_CONFIG['uk'])

# Fonts & layout
TITLE_FONT = "Helvetica-Bold"
TEXT_FONT = "Helvetica"
TITLE_SIZE = 9
VALUE_BASE_SIZE = 9
VALUE_MIN_SIZE = 4
LINE_SPACING = 9

# Barcode options
BARCODE_OPTIONS = {
    "module_width": 0.5,
    "module_height": 13,
    "font_size": 10,
    "text_distance": 5,
    "quiet_zone": 0,
    "write_text": True,
    "dpi": 300,
}


# ---------------------------------------------------------------------
# FONT FITTING HELPERS
# ---------------------------------------------------------------------
def fit_value_font(c: canvas.Canvas, label: str, value: str, max_width: float) -> float:
    """Shrink font size until 'Label + Value' fits within the box."""
    size = VALUE_BASE_SIZE
    while size >= VALUE_MIN_SIZE:
        total_width = (
            c.stringWidth(label, TITLE_FONT, TITLE_SIZE)
            + c.stringWidth(" ", TEXT_FONT, size)
            + c.stringWidth(value, TEXT_FONT, size)
        )
        if total_width <= max_width:
            return size
        size -= 0.1
    return VALUE_MIN_SIZE


def fit_wrapped_text(
    c: canvas.Canvas,
    text: str,
    x: float,
    y: float,
    width: float,
    height: float,
    max_lines: int = 4,
    min_font: float = 4.5,
    max_font: float = 12,
):
    """Fit and wrap a product name inside its label box."""
    def wrap(font_size: float):
        c.setFont(TEXT_FONT, font_size)
        words, lines, current = text.split(), [], ""
        for w in words:
            test = (current + " " + w).strip()
            if c.stringWidth(test, TEXT_FONT, font_size) <= width:
                current = test
            else:
                lines.append(current)
                current = w
        if current:
            lines.append(current)
        return lines

    def fits(font_size: float):
        lines = wrap(font_size)
        total_height = len(lines) * (font_size + 1)
        return len(lines) <= max_lines and total_height <= height

    low, high, best = min_font, max_font, min_font
    while high - low > 0.1:
        mid = (low + high) / 2
        if fits(mid):
            best = mid
            low = mid
        else:
            high = mid

    lines = wrap(best)
    line_h = best + 1
    start_y = y + height - line_h

    for i, line in enumerate(lines[:max_lines]):
        yy = start_y - i * line_h
        if i == 0:
            # bold first word
            parts = line.split(maxsplit=1)
            first = parts[0]
            rest = parts[1] if len(parts) > 1 else ""
            c.setFont(TITLE_FONT, best)
            c.drawString(x, yy, first)
            if rest:
                offset = c.stringWidth(first + " ", TITLE_FONT, best)
                c.setFont(TEXT_FONT, best)
                c.drawString(x + offset, yy, rest)
        else:
            c.setFont(TEXT_FONT, best)
            c.drawString(x, yy, line)


# ---------------------------------------------------------------------
# MAIN PDF GENERATOR
# ---------------------------------------------------------------------
def stream_pdf_labels(conn: PGConn, job_id: int) -> StreamingResponse:
    """
    Generate printable labels for a print job — matches Ian's layout.
    One label per product row.
    """
    tmpdir = None
    try:
        # 1. fetch data with region
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT r.sku, r.product_name, r.uk_6m_data, r.fr_6m_data,
                       COALESCE(r.line, j.line) AS line,
                       r.item_id, r.price, COALESCE(j.region, 'uk') AS region
                FROM label_print_items r
                JOIN label_print_jobs j ON j.id = r.job_id
                WHERE r.job_id = %s
                ORDER BY r.sku
                """,
                (job_id,),
            )
            rows = cur.fetchall()
            
        # Determine currency symbol based on region from first row
        currency_symbol = "£" if not rows else ("£" if rows[0][7] == 'uk' else "€")

        if not rows:
            raise ValueError(f"No label items found for job {job_id}")

        # Get region-specific page configuration
        job_region = rows[0][7] if rows else 'uk'
        page_cfg = get_page_config(job_region)
        
        # 2. setup PDF with region-specific page size
        buf = io.BytesIO()
        page_size = (page_cfg['page_width'], page_cfg['page_height'])
        c = canvas.Canvas(buf, pagesize=page_size)
        today = datetime.today().strftime("%d/%m/%y")
        page_w, page_h = page_size
        x0 = page_cfg['left_margin']
        y0 = page_h - page_cfg['label_height'] - page_cfg['top_margin']
        label_no = 0
        
        # Extract config values for use in label rendering
        label_width = page_cfg['label_width']
        label_height = page_cfg['label_height']
        rows_per_page = page_cfg['rows_per_page']
        cols_per_page = page_cfg['cols_per_page']

        tmpdir = tempfile.mkdtemp()

        # 3. render labels
        for sku, name, uk, fr, line, barcode_val, price, region in rows:
            col = label_no % cols_per_page
            row_pos = (label_no // cols_per_page) % rows_per_page
            x = x0 + col * label_width
            y = y0 - row_pos * label_height
            c.rect(x, y, label_width, label_height)

            # --- product name block ---
            fit_wrapped_text(
                c,
                text=str(name or ""),
                x=x + 4,
                y=y + 38,
                width=label_width - 84,
                height=38,
            )

            # --- right info block ---
            right_x = x + label_width - 69
            max_w = label_width - (right_x - x) - 4
            
            # Format price with region-appropriate currency symbol
            symbol = "£" if region == 'uk' else "€"
            if price is not None and price != "":
                try:
                    price_float = float(price)
                    price_str = f"{symbol}{price_float:.2f}"
                except (ValueError, TypeError):
                    price_str = "N/A"
            else:
                price_str = "N/A"
            
            important = [
                ("Date:", today),
                ("Line:", ""),  # left blank intentionally - to be written on after printing
                ("Price:", price_str),
                ("SKU:", str(sku or "")),
            ]
            start_y = y + label_height - 12
            for i, (label, value) in enumerate(important):
                yy = start_y - i * LINE_SPACING
                c.setFont(TITLE_FONT, TITLE_SIZE)
                c.drawString(right_x, yy, label)
                lw = c.stringWidth(label, TITLE_FONT, TITLE_SIZE)
                if label == "SKU:":
                    c.setFont(TEXT_FONT, VALUE_BASE_SIZE)
                    c.drawString(right_x + lw + 1, yy, value)
                else:
                    fitted = fit_value_font(c, label, value, max_w)
                    c.setFont(TEXT_FONT, fitted)
                    c.drawString(right_x + lw + 1, yy, value)

            # --- FR/UK bottom block ---
            uk_str = str(uk if uk is not None else "0")
            fr_str = str(fr if fr is not None else "0")
            for j, (label, value) in enumerate([("UK:", uk_str), ("FR:", fr_str)]):
                yy = y + 4.5 + j * LINE_SPACING
                fitted = fit_value_font(c, label, value, max_w)
                c.setFont(TITLE_FONT, TITLE_SIZE)
                c.drawString(right_x, yy, label)
                lw = c.stringWidth(label, TITLE_FONT, TITLE_SIZE)
                c.setFont(TEXT_FONT, fitted)
                c.drawString(right_x + lw + 1, yy, value)

            # --- barcode ---
            try:
                barcode_path = os.path.join(tmpdir, f"barcode_{label_no}")
                barcode_value = str(barcode_val or sku or "NONE")
                Code128(barcode_value, writer=ImageWriter()).save(barcode_path, BARCODE_OPTIONS)
                img_path = barcode_path + ".png"
                barcode_width = label_width - 10
                barcode_height = 13 * mm
                barcode_x = x + (label_width - barcode_width) / 2
                c.drawImage(
                    img_path,
                    barcode_x,
                    y + 1,
                    width=barcode_width,
                    height=barcode_height,
                    preserveAspectRatio=True,
                    anchor="sw",
                    mask="auto",
                )
            except Exception as e:
                # Log barcode generation errors but continue
                print(f"Warning: Could not generate barcode for {barcode_val or sku}: {e}")
                pass

            label_no += 1
            if label_no % (cols_per_page * rows_per_page) == 0:
                c.showPage()

        # Save the final page (even if not full)
        if label_no > 0:
            c.showPage()
        
        c.save()
        buf.seek(0)
        
        pdf_bytes = buf.getvalue()
        print(f"[Labels PDF] Generated PDF for job {job_id}: {len(pdf_bytes)} bytes, {label_no} labels")

        # 4. return response
        filename = f"labels_job_{job_id}.pdf"
        return StreamingResponse(
            io.BytesIO(pdf_bytes),
            media_type="application/pdf",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )
    
    except Exception as e:
        print(f"Error generating PDF for job {job_id}: {e}")
        raise
    finally:
        # Clean up temp directory
        if tmpdir and os.path.exists(tmpdir):
            try:
                shutil.rmtree(tmpdir)
            except Exception as e:
                print(f"Warning: Could not clean up temp directory {tmpdir}: {e}")
