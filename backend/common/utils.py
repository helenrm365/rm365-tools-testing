# common/utils.py
from __future__ import annotations

import base64
import csv
import io
import os
import re
import tempfile
import time
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Any, Dict, Generator, Iterable, List, Optional, Sequence, Tuple, TypeVar

T = TypeVar("T")

# ──────────────────────────────────────────────────────────────────────────────
# Time & filenames
# ──────────────────────────────────────────────────────────────────────────────

def now_iso() -> str:
    """UTC timestamp in ISO8601 without timezone suffix (frontend-friendly)."""
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")

def today_dmy() -> str:
    """'dd/mm/yy' like your labels use."""
    return datetime.today().strftime("%d/%m/%y")

def timestamped_filename(prefix: str, ext: str, ts: Optional[datetime] = None) -> str:
    """
    Build 'prefix_YYYY-MM-DD_HH-MM-SS.ext' (no spaces/colons, safe for most filesystems).
    """
    ts = ts or datetime.now()
    stamp = ts.strftime("%Y-%m-%d_%H-%M-%S")
    ext = ext.lstrip(".")
    return f"{prefix}_{stamp}.{ext}"

# ──────────────────────────────────────────────────────────────────────────────
# Filesystem helpers
# ──────────────────────────────────────────────────────────────────────────────

def ensure_dir(path: str) -> str:
    """mkdir -p for a directory; returns the path."""
    os.makedirs(path, exist_ok=True)
    return path

@contextmanager
def temp_dir(prefix: str = "tmp") -> Generator[str, None, None]:
    """Yield a temporary directory and clean it up afterwards."""
    d = tempfile.mkdtemp(prefix=f"{prefix}_")
    try:
        yield d
    finally:
        try:
            # Lazy cleanup to avoid raising if something already removed it
            import shutil
            shutil.rmtree(d, ignore_errors=True)
        except Exception:
            pass

# ──────────────────────────────────────────────────────────────────────────────
# CSV utils (derived from your FR importer usage)
# ──────────────────────────────────────────────────────────────────────────────

def read_csv_bytes(contents: bytes, encoding: str = "utf-8") -> Tuple[List[str], List[List[str]]]:
    """
    Decode raw CSV bytes into (headers, rows) using the same pattern as your importer.
    """
    decoded = contents.decode(encoding)
    reader = csv.reader(io.StringIO(decoded))
    headers = next(reader, [])
    rows = [row for row in reader]
    return headers, rows  # :contentReference[oaicite:0]{index=0}

def read_csv_dicts(contents: bytes, encoding: str = "utf-8") -> List[Dict[str, str]]:
    """
    DictReader variant for when you want keyed rows.
    """
    decoded = contents.decode(encoding)
    reader = csv.DictReader(io.StringIO(decoded))
    return list(reader)

# ──────────────────────────────────────────────────────────────────────────────
# Database convenience
# ──────────────────────────────────────────────────────────────────────────────

def cursor_to_dicts(cur) -> List[Dict[str, Any]]:
    """
    Convert a psycopg2 cursor result to a list of dicts keyed by column name.
    """
    cols = [c.name if hasattr(c, "name") else c[0] for c in cur.description]
    return [dict(zip(cols, row)) for row in cur.fetchall()]

def df_from_sql(engine, query: str):
    """
    Pandas passthrough, matching how you currently build your labels DataFrame.
    """
    import pandas as pd
    return pd.read_sql_query(query, engine)  # :contentReference[oaicite:1]{index=1}

# ──────────────────────────────────────────────────────────────────────────────
# Safe casting & collections
# ──────────────────────────────────────────────────────────────────────────────

def safe_int(val: Any, default: int = 0) -> int:
    try:
        return int(val)
    except Exception:
        return default

def safe_float(val: Any, default: float = 0.0) -> float:
    try:
        return float(val)
    except Exception:
        return default

def chunked(iterable: Iterable[T], size: int) -> Iterable[List[T]]:
    """
    Yield lists of length <= size from an iterable.
    """
    buf: List[T] = []
    for item in iterable:
        buf.append(item)
        if len(buf) >= size:
            yield buf
            buf = []
    if buf:
        yield buf

# ──────────────────────────────────────────────────────────────────────────────
# Base64 helpers (useful for fingerprint templates & label assets)
# ──────────────────────────────────────────────────────────────────────────────

def b64_encode(data: bytes) -> str:
    return base64.b64encode(data).decode("ascii")

def b64_decode(data_b64: str) -> bytes:
    return base64.b64decode(data_b64.encode("ascii"))

# ──────────────────────────────────────────────────────────────────────────────
# Domain helpers
# ──────────────────────────────────────────────────────────────────────────────

_EMP_CODE_RE = re.compile(r"^EMP(\d+)$")

def next_employee_code(last_code: Optional[str]) -> str:
    """
    Generate the next EMP code in the sequence, mirroring your manager logic:
      - If last_code like 'EMP009' -> 'EMP010'
      - If none -> 'EMP001'
    """
    if last_code:
        m = _EMP_CODE_RE.match(last_code)
        if m:
            num = int(m.group(1)) + 1
            return f"EMP{num:03d}"
    return "EMP001"  # :contentReference[oaicite:2]{index=2}

# ──────────────────────────────────────────────────────────────────────────────
# Label-specific helpers (lightweight and generic)
# ──────────────────────────────────────────────────────────────────────────────

def label_date_today() -> str:
    """
    The label generator prints today's date in 'dd/mm/yy' format; keep a tiny helper
    so both generator and any previews use the same format.
    """
    return today_dmy()  # :contentReference[oaicite:3]{index=3}
