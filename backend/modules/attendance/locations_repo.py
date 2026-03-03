"""Repository for managing employee locations."""
from typing import List, Dict, Any, Optional
from common.deps import pg_conn
import logging

logger = logging.getLogger(__name__)


class LocationsRepo:
    """Database operations for locations table."""

    def init_table(self) -> Dict[str, Any]:
        """Create locations table if it doesn't exist and seed default locations."""
        with pg_conn() as conn:
            with conn.cursor() as cur:
                # Check if table exists
                cur.execute("""
                    SELECT EXISTS (
                        SELECT FROM information_schema.tables 
                        WHERE table_schema = 'public' 
                        AND table_name = 'locations'
                    )
                """)
                table_exists = cur.fetchone()[0]
                
                if not table_exists:
                    # Create the locations table with name, city_code, country_code, and timezone
                    cur.execute("""
                        CREATE TABLE locations (
                            id SERIAL PRIMARY KEY,
                            name VARCHAR(255) NOT NULL,
                            city_code VARCHAR(10) NOT NULL,
                            country_code VARCHAR(10) NOT NULL,
                            timezone VARCHAR(50) NOT NULL DEFAULT 'UTC',
                            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                            UNIQUE(name, city_code, country_code)
                        )
                    """)
                    logger.info("✅ Created table: locations")
                    
                    # Insert default locations with timezones
                    cur.execute("""
                        INSERT INTO locations (name, city_code, country_code, timezone) VALUES
                        ('Birmingham', 'BHX', 'UK', 'Europe/London'),
                        ('London', 'LON', 'UK', 'Europe/London'),
                        ('Paris', 'PAR', 'FR', 'Europe/Paris')
                        ON CONFLICT (name, city_code, country_code) DO NOTHING
                    """)
                    logger.info("✅ Seeded default locations: Birmingham, London (Europe/London), Paris (Europe/Paris)")
                    
                    conn.commit()
                    return {
                        'status': 'success',
                        'message': 'Locations table created and seeded with defaults',
                        'created': True
                    }
                else:
                    logger.info("ℹ️  Table already exists: locations")
                    # Run migrations for existing tables
                    cur.execute("""
                        ALTER TABLE locations
                        ADD COLUMN IF NOT EXISTS timezone VARCHAR(50) NOT NULL DEFAULT 'UTC'
                    """)
                    # Ensure all known locations have the correct timezone set
                    cur.execute("""
                        UPDATE locations SET timezone = 'Europe/London'
                        WHERE LOWER(name) IN ('birmingham', 'london') AND timezone = 'UTC'
                    """)
                    cur.execute("""
                        UPDATE locations SET timezone = 'Europe/Paris'
                        WHERE LOWER(name) = 'paris' AND timezone = 'UTC'
                    """)
                    conn.commit()
                    return {
                        'status': 'success',
                        'message': 'Locations table already exists',
                        'created': False
                    }

    def list_all(self) -> List[Dict[str, Any]]:
        """Get all locations ordered by country_code, then name."""
        with pg_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    SELECT id, name, city_code, country_code, timezone, created_at::text
                    FROM locations
                    ORDER BY country_code, name
                """)
                rows = cur.fetchall()
                return [
                    {
                        'id': row[0],
                        'name': row[1],
                        'city_code': row[2],
                        'country_code': row[3],
                        'timezone': row[4],
                        'created_at': row[5]
                    }
                    for row in rows
                ]

    def get_by_id(self, location_id: int) -> Optional[Dict[str, Any]]:
        """Get a location by ID."""
        with pg_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    SELECT id, name, city_code, country_code, timezone, created_at::text
                    FROM locations
                    WHERE id = %s
                """, (location_id,))
                row = cur.fetchone()
                if row:
                    return {
                        'id': row[0],
                        'name': row[1],
                        'city_code': row[2],
                        'country_code': row[3],
                        'timezone': row[4],
                        'created_at': row[5]
                    }
                return None

    def get_by_name(self, name: str) -> Optional[Dict[str, Any]]:
        """Get a location by name."""
        with pg_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    SELECT id, name, city_code, country_code, timezone, created_at::text
                    FROM locations
                    WHERE LOWER(name) = LOWER(%s)
                """, (name,))
                row = cur.fetchone()
                if row:
                    return {
                        'id': row[0],
                        'name': row[1],
                        'city_code': row[2],
                        'country_code': row[3],
                        'timezone': row[4],
                        'created_at': row[5]
                    }
                return None

    def get_by_city_code(self, city_code: str) -> Optional[Dict[str, Any]]:
        """Get a location by city code."""
        with pg_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    SELECT id, name, city_code, country_code, timezone, created_at::text
                    FROM locations
                    WHERE UPPER(city_code) = UPPER(%s)
                """, (city_code,))
                row = cur.fetchone()
                if row:
                    return {
                        'id': row[0],
                        'name': row[1],
                        'city_code': row[2],
                        'country_code': row[3],
                        'timezone': row[4],
                        'created_at': row[5]
                    }
                return None

    def list_by_country_code(self, country_code: str) -> List[Dict[str, Any]]:
        """Get all locations for a country code."""
        with pg_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    SELECT id, name, city_code, country_code, timezone, created_at::text
                    FROM locations
                    WHERE UPPER(country_code) = UPPER(%s)
                    ORDER BY name
                """, (country_code,))
                rows = cur.fetchall()
                return [
                    {
                        'id': row[0],
                        'name': row[1],
                        'city_code': row[2],
                        'country_code': row[3],
                        'timezone': row[4],
                        'created_at': row[5]
                    }
                    for row in rows
                ]

    def get_unique_country_codes(self) -> List[str]:
        """Get all unique country codes."""
        with pg_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    SELECT DISTINCT country_code
                    FROM locations
                    ORDER BY country_code
                """)
                return [row[0] for row in cur.fetchall()]

    def create(self, name: str, city_code: str, country_code: str, timezone: str = 'UTC') -> Dict[str, Any]:
        """Create a new location."""
        with pg_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    INSERT INTO locations (name, city_code, country_code, timezone)
                    VALUES (%s, %s, %s, %s)
                    RETURNING id, name, city_code, country_code, timezone, created_at::text
                """, (name, city_code.upper(), country_code.upper(), timezone))
                row = cur.fetchone()
                conn.commit()
                return {
                    'id': row[0],
                    'name': row[1],
                    'city_code': row[2],
                    'country_code': row[3],
                    'timezone': row[4],
                    'created_at': row[5]
                }

    def update(self, location_id: int, name: str = None, city_code: str = None, country_code: str = None, timezone: str = None) -> Optional[Dict[str, Any]]:
        """Update an existing location."""
        sets, vals = [], []
        if name is not None:
            sets.append("name = %s")
            vals.append(name)
        if city_code is not None:
            sets.append("city_code = %s")
            vals.append(city_code.upper())
        if country_code is not None:
            sets.append("country_code = %s")
            vals.append(country_code.upper())
        if timezone is not None:
            sets.append("timezone = %s")
            vals.append(timezone)
        
        if not sets:
            return self.get_by_id(location_id)
        
        vals.append(location_id)
        
        with pg_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(f"""
                    UPDATE locations
                    SET {', '.join(sets)}
                    WHERE id = %s
                    RETURNING id, name, city_code, country_code, timezone, created_at::text
                """, vals)
                row = cur.fetchone()
                conn.commit()
                if row:
                    return {
                        'id': row[0],
                        'name': row[1],
                        'city_code': row[2],
                        'country_code': row[3],
                        'timezone': row[4],
                        'created_at': row[5]
                    }
                return None

    def delete(self, location_id: int) -> bool:
        """Delete a location. Returns True if deleted."""
        with pg_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("DELETE FROM locations WHERE id = %s", (location_id,))
                deleted = cur.rowcount > 0
                conn.commit()
                return deleted
