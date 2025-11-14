-- backend/migrations/add_performance_indexes.sql
-- Performance optimization: Add indexes to frequently queried columns
-- Run this migration to significantly improve query performance

-- ============================================
-- SALES DATA TABLES INDEXES
-- ============================================

-- UK Sales Data
CREATE INDEX IF NOT EXISTS idx_uk_sales_sku ON uk_sales_data(sku);
CREATE INDEX IF NOT EXISTS idx_uk_sales_order ON uk_sales_data(order_number);
CREATE INDEX IF NOT EXISTS idx_uk_sales_customer_email ON uk_sales_data(customer_email);
CREATE INDEX IF NOT EXISTS idx_uk_sales_created_at ON uk_sales_data(created_at);
CREATE INDEX IF NOT EXISTS idx_uk_sales_status ON uk_sales_data(status);
-- Composite index for common search patterns
CREATE INDEX IF NOT EXISTS idx_uk_sales_search ON uk_sales_data(sku, customer_email, order_number);
-- Index for price/total filtering
CREATE INDEX IF NOT EXISTS idx_uk_sales_grand_total ON uk_sales_data(grand_total) WHERE grand_total IS NOT NULL;

-- FR Sales Data
CREATE INDEX IF NOT EXISTS idx_fr_sales_sku ON fr_sales_data(sku);
CREATE INDEX IF NOT EXISTS idx_fr_sales_order ON fr_sales_data(order_number);
CREATE INDEX IF NOT EXISTS idx_fr_sales_customer_email ON fr_sales_data(customer_email);
CREATE INDEX IF NOT EXISTS idx_fr_sales_created_at ON fr_sales_data(created_at);
CREATE INDEX IF NOT EXISTS idx_fr_sales_status ON fr_sales_data(status);
CREATE INDEX IF NOT EXISTS idx_fr_sales_search ON fr_sales_data(sku, customer_email, order_number);
CREATE INDEX IF NOT EXISTS idx_fr_sales_grand_total ON fr_sales_data(grand_total) WHERE grand_total IS NOT NULL;

-- NL Sales Data
CREATE INDEX IF NOT EXISTS idx_nl_sales_sku ON nl_sales_data(sku);
CREATE INDEX IF NOT EXISTS idx_nl_sales_order ON nl_sales_data(order_number);
CREATE INDEX IF NOT EXISTS idx_nl_sales_customer_email ON nl_sales_data(customer_email);
CREATE INDEX IF NOT EXISTS idx_nl_sales_created_at ON nl_sales_data(created_at);
CREATE INDEX IF NOT EXISTS idx_nl_sales_status ON nl_sales_data(status);
CREATE INDEX IF NOT EXISTS idx_nl_sales_search ON nl_sales_data(sku, customer_email, order_number);
CREATE INDEX IF NOT EXISTS idx_nl_sales_grand_total ON nl_sales_data(grand_total) WHERE grand_total IS NOT NULL;

-- ============================================
-- CONDENSED SALES TABLES INDEXES
-- ============================================

CREATE INDEX IF NOT EXISTS idx_uk_condensed_sku ON uk_condensed_sales(sku);
CREATE INDEX IF NOT EXISTS idx_uk_condensed_total_qty ON uk_condensed_sales(total_qty);

CREATE INDEX IF NOT EXISTS idx_fr_condensed_sku ON fr_condensed_sales(sku);
CREATE INDEX IF NOT EXISTS idx_fr_condensed_total_qty ON fr_condensed_sales(total_qty);

CREATE INDEX IF NOT EXISTS idx_nl_condensed_sku ON nl_condensed_sales(sku);
CREATE INDEX IF NOT EXISTS idx_nl_condensed_total_qty ON nl_condensed_sales(total_qty);

-- ============================================
-- SUPPORTING TABLES INDEXES
-- ============================================

-- SKU Aliases
CREATE INDEX IF NOT EXISTS idx_sku_aliases_alias ON sku_aliases(alias_sku);
CREATE INDEX IF NOT EXISTS idx_sku_aliases_unified ON sku_aliases(unified_sku);

-- Import History
CREATE INDEX IF NOT EXISTS idx_import_history_region ON import_history(region);
CREATE INDEX IF NOT EXISTS idx_import_history_imported_at ON import_history(imported_at);
CREATE INDEX IF NOT EXISTS idx_import_history_status ON import_history(status);

-- Excluded Customers
CREATE INDEX IF NOT EXISTS idx_excluded_customers_region ON condensed_sales_excluded_customers(region);
CREATE INDEX IF NOT EXISTS idx_excluded_customers_email ON condensed_sales_excluded_customers(customer_email);

-- ============================================
-- ATTENDANCE TABLES INDEXES (if applicable)
-- ============================================

-- Attendance logs (adjust table name if different)
DO $$ 
BEGIN
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'attendance_logs') THEN
        CREATE INDEX IF NOT EXISTS idx_attendance_employee_id ON attendance_logs(employee_id);
        CREATE INDEX IF NOT EXISTS idx_attendance_timestamp ON attendance_logs(timestamp);
        CREATE INDEX IF NOT EXISTS idx_attendance_direction ON attendance_logs(direction);
        CREATE INDEX IF NOT EXISTS idx_attendance_location ON attendance_logs(location) WHERE location IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_attendance_date_employee ON attendance_logs(timestamp, employee_id);
    END IF;
END $$;

-- Employees (adjust table name if different)
DO $$ 
BEGIN
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'employees') THEN
        CREATE INDEX IF NOT EXISTS idx_employees_location ON employees(location) WHERE location IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_employees_full_name ON employees(full_name);
    END IF;
END $$;

-- ============================================
-- USERS & ROLES INDEXES
-- ============================================

-- Login users (if using PostgreSQL for auth)
DO $$ 
BEGIN
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'login_users') THEN
        CREATE INDEX IF NOT EXISTS idx_login_users_username ON login_users(username);
        CREATE INDEX IF NOT EXISTS idx_login_users_role ON login_users(role) WHERE role IS NOT NULL;
    END IF;
END $$;

-- ============================================
-- FULL-TEXT SEARCH OPTIMIZATION (ADVANCED)
-- ============================================

-- Optional: Add full-text search indexes for better text search performance
-- Uncomment if you want to use PostgreSQL's full-text search capabilities

-- CREATE INDEX IF NOT EXISTS idx_uk_sales_fulltext ON uk_sales_data 
--   USING GIN(to_tsvector('english', name || ' ' || COALESCE(sku, '') || ' ' || COALESCE(customer_full_name, '')));

-- CREATE INDEX IF NOT EXISTS idx_fr_sales_fulltext ON fr_sales_data 
--   USING GIN(to_tsvector('english', name || ' ' || COALESCE(sku, '') || ' ' || COALESCE(customer_full_name, '')));

-- CREATE INDEX IF NOT EXISTS idx_nl_sales_fulltext ON nl_sales_data 
--   USING GIN(to_tsvector('english', name || ' ' || COALESCE(sku, '') || ' ' || COALESCE(customer_full_name, '')));

-- ============================================
-- VERIFY INDEXES CREATED
-- ============================================

-- Query to verify indexes were created successfully:
-- SELECT schemaname, tablename, indexname 
-- FROM pg_indexes 
-- WHERE tablename IN ('uk_sales_data', 'fr_sales_data', 'nl_sales_data')
-- ORDER BY tablename, indexname;
