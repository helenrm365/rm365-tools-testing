-- Add price column to label_print_items table
-- Run this migration if you have an existing label_print_items table

-- Add price column if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'label_print_items' 
        AND column_name = 'price'
    ) THEN
        ALTER TABLE label_print_items 
        ADD COLUMN price DECIMAL(10, 2) DEFAULT 0.00;
        
        RAISE NOTICE 'Added price column to label_print_items table';
    ELSE
        RAISE NOTICE 'Price column already exists in label_print_items table';
    END IF;
END $$;
