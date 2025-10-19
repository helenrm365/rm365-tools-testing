"""
Database models for roles table
"""

# Table schema:
# CREATE TABLE IF NOT EXISTS roles (
#     id SERIAL PRIMARY KEY,
#     role_name VARCHAR(100) UNIQUE NOT NULL,
#     allowed_tabs TEXT,
#     created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
#     updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
# );

# Sample data:
# INSERT INTO roles (role_name, allowed_tabs) VALUES
# ('admin', 'enrollment,inventory,attendance,labels,sales-imports,usermanagement'),
# ('manager', 'enrollment,inventory,attendance,labels,sales-imports'),
# ('user', 'enrollment,attendance')
# ON CONFLICT (role_name) DO NOTHING;
