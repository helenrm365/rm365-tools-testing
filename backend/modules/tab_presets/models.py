"""
Database model for the tab_presets table (formerly `roles`).

CREATE TABLE IF NOT EXISTS tab_presets (
    id SERIAL PRIMARY KEY,
    preset_name VARCHAR(100) UNIQUE NOT NULL,
    allowed_tabs TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

System presets (locked):
  - admin   — full access (resolved at runtime)
  - custom  — per-user tab selection
"""
