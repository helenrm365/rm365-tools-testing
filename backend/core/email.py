"""
Brevo transactional email client.

Uses httpx (already in requirements) to call the Brevo REST API.
No additional dependencies needed.

Set in .env:
  BREVO_API_KEY=xkeysib-...
  EMAIL_FROM=noreply@yourdomain.com
  EMAIL_FROM_NAME=RM365 Tools
  APP_BASE_URL=https://yourdomain.com
"""

import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from typing import Tuple

import httpx

from core.config import settings
from core.db import get_psycopg_connection, return_attendance_connection

BREVO_API_URL = "https://api.brevo.com/v3/smtp/email"

_RESEND_MAX = 3
_RESEND_WINDOW_SECONDS = 900  # 15 minutes
_CODE_TTL_MINUTES = 15


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _now_utc() -> datetime:
    """Always return a tz-aware UTC datetime (safe to compare with psycopg2 TIMESTAMPTZ)."""
    return datetime.now(timezone.utc)


def _hash_token(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


def _generate_code() -> str:
    """Cryptographically random 6-digit numeric code."""
    return f"{secrets.randbelow(1_000_000):06d}"


async def _send(to_email: str, to_name: str, subject: str, html: str, text: str) -> None:
    """Send a transactional email via Brevo REST API."""
    if not settings.BREVO_API_KEY:
        raise RuntimeError("BREVO_API_KEY is not configured in .env")

    payload = {
        "sender": {"name": settings.EMAIL_FROM_NAME, "email": settings.EMAIL_FROM},
        "to": [{"email": to_email, "name": to_name}],
        "subject": subject,
        "htmlContent": html,
        "textContent": text,
    }

    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.post(
            BREVO_API_URL,
            json=payload,
            headers={"api-key": settings.BREVO_API_KEY, "Content-Type": "application/json"},
        )

    if resp.status_code not in (200, 201):
        raise RuntimeError(f"Brevo API error {resp.status_code}: {resp.text}")


# ---------------------------------------------------------------------------
# Password reset
# ---------------------------------------------------------------------------

def create_password_reset_token(username: str) -> str:
    """
    Generate a secure reset token, persist its hash to the DB, and return
    the raw token to embed in the email link.
    """
    raw = secrets.token_urlsafe(32)
    hashed = _hash_token(raw)
    expires_at = _now_utc() + timedelta(hours=1)

    conn = get_psycopg_connection()
    try:
        cur = conn.cursor()
        cur.execute(
            """
            INSERT INTO password_reset_tokens (username, token_hash, expires_at)
            VALUES (%s, %s, %s)
            ON CONFLICT (username)
            DO UPDATE SET token_hash = EXCLUDED.token_hash, expires_at = EXCLUDED.expires_at
            """,
            (username, hashed, expires_at),
        )
        conn.commit()
    finally:
        return_attendance_connection(conn)

    return raw


def verify_and_consume_reset_token(token: str) -> str:
    """
    Validate the raw token. Returns the username on success.
    Raises ValueError if invalid or expired. Deletes the token after use.
    """
    hashed = _hash_token(token)

    conn = get_psycopg_connection()
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT username, expires_at FROM password_reset_tokens WHERE token_hash = %s",
            (hashed,),
        )
        row = cur.fetchone()

        if not row:
            raise ValueError("Invalid or already-used reset token")

        username, expires_at = row
        if _now_utc() > expires_at:
            cur.execute("DELETE FROM password_reset_tokens WHERE token_hash = %s", (hashed,))
            conn.commit()
            raise ValueError("Reset token has expired")

        cur.execute("DELETE FROM password_reset_tokens WHERE token_hash = %s", (hashed,))
        conn.commit()
        return username
    finally:
        return_attendance_connection(conn)


# ---------------------------------------------------------------------------
# Email verification (6-digit code flow)
# ---------------------------------------------------------------------------

def create_email_verification_code(username: str, pending_email: str) -> str:
    """
    Generate a fresh 6-digit code for verifying pending_email on username.
    Resets the resend counter. Returns the raw code to send in the email.
    The email is NOT saved to login_users until verify_email_code() succeeds.
    """
    raw = _generate_code()
    code_hash = _hash_token(raw)
    expires_at = _now_utc() + timedelta(minutes=_CODE_TTL_MINUTES)

    conn = get_psycopg_connection()
    try:
        cur = conn.cursor()
        cur.execute(
            """
            INSERT INTO email_verification_tokens
                (username, pending_email, code_hash, expires_at, resend_count, window_start)
            VALUES (%s, %s, %s, %s, 0, NOW())
            ON CONFLICT (username) DO UPDATE SET
                pending_email = EXCLUDED.pending_email,
                code_hash     = EXCLUDED.code_hash,
                expires_at    = EXCLUDED.expires_at,
                resend_count  = 0,
                window_start  = NOW(),
                created_at    = NOW()
            """,
            (username, pending_email, code_hash, expires_at),
        )
        conn.commit()
    finally:
        return_attendance_connection(conn)

    return raw


def resend_email_verification_code(username: str) -> Tuple[str, str]:
    """
    Issue a new code for the pending email already on file.
    Rate-limited to 3 resends per 15-minute window per user.

    Returns (raw_code, pending_email).
    Raises ValueError if no pending verification exists or rate limit is hit.
    """
    conn = get_psycopg_connection()
    try:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT pending_email, resend_count, window_start
            FROM email_verification_tokens WHERE username = %s
            """,
            (username,),
        )
        row = cur.fetchone()

        if not row:
            raise ValueError("No pending email verification for this user")

        pending_email, resend_count, window_start = row
        now = _now_utc()
        elapsed = (now - window_start).total_seconds()

        if elapsed > _RESEND_WINDOW_SECONDS:
            # Window expired — open a fresh window
            resend_count = 0
            new_window_start = now
        else:
            new_window_start = window_start
            if resend_count >= _RESEND_MAX:
                remaining = int(_RESEND_WINDOW_SECONDS - elapsed)
                raise ValueError(
                    f"Resend limit reached. Try again in {remaining // 60}m {remaining % 60}s."
                )

        raw = _generate_code()
        code_hash = _hash_token(raw)
        expires_at = now + timedelta(minutes=_CODE_TTL_MINUTES)

        cur.execute(
            """
            UPDATE email_verification_tokens
            SET code_hash = %s, expires_at = %s, resend_count = %s, window_start = %s
            WHERE username = %s
            """,
            (code_hash, expires_at, resend_count + 1, new_window_start, username),
        )
        conn.commit()
    finally:
        return_attendance_connection(conn)

    return raw, pending_email


def verify_email_code(username: str, code: str) -> str:
    """
    Verify the 6-digit code for username.
    On success: atomically deletes the token AND saves the email to login_users.
    Returns the verified email address.
    Raises ValueError on invalid or expired code.
    """
    code_hash = _hash_token(code)

    conn = get_psycopg_connection()
    try:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT pending_email, expires_at
            FROM email_verification_tokens
            WHERE username = %s AND code_hash = %s
            """,
            (username, code_hash),
        )
        row = cur.fetchone()

        if not row:
            raise ValueError("Invalid verification code")

        pending_email, expires_at = row
        if _now_utc() > expires_at:
            cur.execute(
                "DELETE FROM email_verification_tokens WHERE username = %s", (username,)
            )
            conn.commit()
            raise ValueError("Verification code has expired. Request a new one.")

        # Atomic: consume token + save verified email in the same transaction
        cur.execute(
            "DELETE FROM email_verification_tokens WHERE username = %s", (username,)
        )
        cur.execute(
            "UPDATE login_users SET email = %s WHERE username = %s",
            (pending_email, username),
        )
        conn.commit()
        return pending_email
    finally:
        return_attendance_connection(conn)


# ---------------------------------------------------------------------------
# Email templates
# ---------------------------------------------------------------------------

async def send_password_reset_email(to_email: str, username: str, token: str) -> None:
    reset_link = f"{settings.APP_BASE_URL}/reset-password?token={token}"

    html = f"""
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto">
      <h2 style="color:#333">Password Reset Request</h2>
      <p>Hi <strong>{username}</strong>,</p>
      <p>We received a request to reset your RM365 Tools password.
         Click the button below — this link is valid for <strong>1 hour</strong>.</p>
      <p style="text-align:center;margin:32px 0">
        <a href="{reset_link}"
           style="background:#4f46e5;color:#fff;padding:12px 24px;
                  border-radius:6px;text-decoration:none;font-weight:bold">
          Reset Password
        </a>
      </p>
      <p style="color:#666;font-size:13px">
        If you didn't request this, you can ignore this email.<br>
        Link: <a href="{reset_link}">{reset_link}</a>
      </p>
    </div>
    """

    text = (
        f"Hi {username},\n\n"
        f"Reset your RM365 Tools password here (valid 1 hour):\n{reset_link}\n\n"
        f"If you didn't request this, ignore this email."
    )

    await _send(to_email, username, "Reset your RM365 Tools password", html, text)


async def send_email_verification_email(to_email: str, username: str, code: str) -> None:
    html = f"""
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto">
      <h2 style="color:#333">Verify Your Email</h2>
      <p>Hi <strong>{username}</strong>,</p>
      <p>Use the code below to verify this email address for your RM365 Tools account.
         It expires in <strong>15 minutes</strong>.</p>
      <div style="text-align:center;margin:32px 0">
        <span style="display:inline-block;font-size:36px;font-weight:bold;
                     letter-spacing:8px;background:#f3f4f6;padding:16px 32px;
                     border-radius:8px;color:#111">{code}</span>
      </div>
      <p style="color:#666;font-size:13px">
        If you didn't expect this, you can safely ignore it.
      </p>
    </div>
    """

    text = (
        f"Hi {username},\n\n"
        f"Your RM365 Tools email verification code is: {code}\n\n"
        f"Expires in 15 minutes. If you didn't expect this, ignore it."
    )

    await _send(to_email, username, "Your RM365 Tools verification code", html, text)
