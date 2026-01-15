from modules.magentodata.db import get_magento_connection
import logging
logging.basicConfig(level=logging.INFO)

conn = get_magento_connection('uk')
with conn.cursor() as cur:
    # Check what discontinued_status values exist
    cur.execute('''
        SELECT DISTINCT cpev.value as discontinued_status, COUNT(*) as count
        FROM catalog_product_entity cpe
        LEFT JOIN catalog_product_entity_varchar cpev
            ON cpe.entity_id = cpev.entity_id
            AND cpev.attribute_id = (
                SELECT attribute_id 
                FROM eav_attribute 
                WHERE attribute_code = 'discontinued_status' 
                AND entity_type_id = (
                    SELECT entity_type_id 
                    FROM eav_entity_type 
                    WHERE entity_type_code = 'catalog_product'
                )
            )
            AND cpev.store_id = 0
        GROUP BY cpev.value
        ORDER BY count DESC
    ''')
    print('\nDiscontinued Status Values in Magento:')
    for row in cur.fetchall():
        print(f'  {repr(row[0])}: {row[1]} products')
conn.close()
