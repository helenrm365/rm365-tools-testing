-- Migration: add email support for password reset
-- Run this once against your attendance database.

-- 1. Add email column to login_users (nullable — existing users won't have one yet)
ALTER TABLE login_users
    ADD COLUMN IF NOT EXISTS email TEXT;

-- Optional: enforce uniqueness once all users have emails
-- ALTER TABLE login_users ADD CONSTRAINT login_users_email_unique UNIQUE (email);

-- 2. Table for password-reset tokens (one active token per user at a time)
CREATE TABLE IF NOT EXISTS password_reset_tokens (
    username    TEXT        PRIMARY KEY REFERENCES login_users(username) ON DELETE CASCADE,
    token_hash  TEXT        NOT NULL,
    expires_at  TIMESTAMPTZ NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
