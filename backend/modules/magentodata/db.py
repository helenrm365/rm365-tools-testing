import pymysql
import pymysql.cursors
import logging
from core.config import settings

logger = logging.getLogger(__name__)

def get_magento_connection(region: str = "uk"):
    """
    Get a connection to the Magento database for the specified region.
    """
    region = region.lower()
    
    host = settings.MAGENTO_DB_HOST
    port = settings.MAGENTO_DB_PORT
    
    if region == "uk":
        user = settings.MAGENTO_DB_USER_UK
        password = settings.MAGENTO_DB_PASSWORD_UK
        db_name = settings.MAGENTO_DB_NAME_UK
    elif region == "nl":
        user = settings.MAGENTO_DB_USER_NL
        password = settings.MAGENTO_DB_PASSWORD_NL
        db_name = settings.MAGENTO_DB_NAME_NL
    elif region == "fr":
        user = settings.MAGENTO_DB_USER_FR
        password = settings.MAGENTO_DB_PASSWORD_FR
        db_name = settings.MAGENTO_DB_NAME_FR
    else:
        raise ValueError(f"Invalid region: {region}")
        
    if not user or not password:
        raise ValueError(f"Database credentials for region {region} are not set")
        
    try:
        conn = pymysql.connect(
            host=host,
            port=port,
            user=user,
            password=password,
            database=db_name,
            cursorclass=pymysql.cursors.DictCursor
        )
        return conn
    except pymysql.MySQLError as e:
        logger.error(f"Error connecting to Magento DB ({region}): {e}")
        raise
