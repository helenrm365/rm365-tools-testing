from __future__ import annotations
import io, os, tempfile
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
PAGE_WIDTH_MM = 103
PAGE_HEIGHT_MM = 200
PAGE_SIZE = (PAGE_WIDTH_MM * mm, PAGE_HEIGHT_MM * mm)

LABEL_WIDTH = 69 * mm
LABEL_HEIGHT = 27 * mm
TOP_MARGIN = 11 * mm
LEFT_MARGIN = 1 * mm
ROWS_PER_PAGE = 7
COLS_PER_PAGE = 1

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
    # 1. fetch data
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT r.sku, r.product_name, r.uk_6m_data, r.fr_6m_data,
                   COALESCE(r.line_date, j.line_date) AS line_date,
                   r.item_id, r.price
            FROM label_print_items r
            JOIN label_print_jobs j ON j.id = r.job_id
            WHERE r.job_id = %s
            ORDER BY r.sku
            """,
            (job_id,),
        )
        rows = cur.fetchall()

    # 2. setup PDF
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=PAGE_SIZE)
    today = datetime.today().strftime("%d/%m/%y")
    page_w, page_h = PAGE_SIZE
    x0 = LEFT_MARGIN
    y0 = page_h - LABEL_HEIGHT - TOP_MARGIN
    label_no = 0

    tmpdir = tempfile.mkdtemp()

    # 3. render labels
    for sku, name, uk, fr, line_date, barcode_val, price in rows:
        col = label_no % COLS_PER_PAGE
        row_pos = (label_no // COLS_PER_PAGE) % ROWS_PER_PAGE
        x = x0 + col * LABEL_WIDTH
        y = y0 - row_pos * LABEL_HEIGHT
        c.rect(x, y, LABEL_WIDTH, LABEL_HEIGHT)

        # --- product name block ---
        fit_wrapped_text(
            c,
            text=str(name),
            x=x + 4,
            y=y + 38,
            width=LABEL_WIDTH - 84,
            height=38,
        )

        # --- right info block ---
        right_x = x + LABEL_WIDTH - 69
        max_w = LABEL_WIDTH - (right_x - x) - 4
        
        # Format price with currency symbol (handle both float and string inputs)
        if price:
            if isinstance(price, (int, float)):
                # Price is already a number
                price_str = f"£{float(price):.2f}"
            else:
                # Price is a string, possibly already formatted
                price_clean = str(price).replace("£", "").replace("€", "").replace("$", "").strip()
                try:
                    price_num = float(price_clean)
                    price_str = f"£{price_num:.2f}"
                except ValueError:
                    # If we can't parse it, use as-is
                    price_str = str(price)
        else:
            price_str = ""
        
        important = [
            ("Date:", today),
            ("Line:", ""),  # left blank intentionally - to be written on after printing
            ("Price:", price_str),
            ("SKU:", sku or ""),
        ]
        start_y = y + LABEL_HEIGHT - 12
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
        for j, (label, value) in enumerate([("UK:", uk), ("FR:", fr)]):
            yy = y + 4.5 + j * LINE_SPACING
            fitted = fit_value_font(c, label, str(value), max_w)
            c.setFont(TITLE_FONT, TITLE_SIZE)
            c.drawString(right_x, yy, label)
            lw = c.stringWidth(label, TITLE_FONT, TITLE_SIZE)
            c.setFont(TEXT_FONT, fitted)
            c.drawString(right_x + lw + 1, yy, str(value))

        # --- barcode ---
        try:
            barcode_path = os.path.join(tmpdir, f"barcode_{label_no}")
            Code128(str(barcode_val or sku), writer=ImageWriter()).save(barcode_path, BARCODE_OPTIONS)
            img_path = barcode_path + ".png"
            barcode_width = LABEL_WIDTH - 10
            barcode_height = 13 * mm
            barcode_x = x + (LABEL_WIDTH - barcode_width) / 2
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
        except Exception:
            pass

        label_no += 1
        if label_no % (COLS_PER_PAGE * ROWS_PER_PAGE) == 0:
            c.showPage()

    c.save()
    buf.seek(0)

    # 4. return response
    filename = f"labels_job_{job_id}.pdf"
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename=\"{filename}\"'},
    )
