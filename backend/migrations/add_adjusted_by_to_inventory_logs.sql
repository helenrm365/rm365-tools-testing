-- Migration: Add adjusted_by column to inventory_logs table
-- Purpose: Track which user made each inventory adjustment
-- Date: 2025-11-17

-- Add the adjusted_by column to store username
ALTER TABLE inventory_logs 
ADD COLUMN IF NOT EXISTS adjusted_by VARCHAR(100);

-- Create an index for better query performance when filtering by user
CREATE INDEX IF NOT EXISTS idx_inventory_logs_adjusted_by 
ON inventory_logs (adjusted_by);

-- Add a comment to document the column
COMMENT ON COLUMN inventory_logs.adjusted_by IS 'Username of the user who made this inventory adjustment';
