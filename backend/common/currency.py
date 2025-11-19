# backend/common/currency.py
"""
Currency conversion utilities using live exchange rates
"""
import logging
import requests
from datetime import datetime, timedelta
from typing import Dict, Optional
from decimal import Decimal

logger = logging.getLogger(__name__)

# Cache for exchange rates
_rates_cache: Optional[Dict[str, float]] = None
_cache_timestamp: Optional[datetime] = None
CACHE_DURATION = timedelta(hours=1)  # Refresh rates every hour

def get_exchange_rates() -> Dict[str, float]:
    """
    Get current exchange rates with GBP as base currency.
    Uses exchangerate-api.com free tier (1500 requests/month)
    Falls back to cached rates if API fails.
    """
    global _rates_cache, _cache_timestamp
    
    # Check if cache is still valid
    if _rates_cache and _cache_timestamp:
        if datetime.now() - _cache_timestamp < CACHE_DURATION:
            logger.debug("Using cached exchange rates")
            return _rates_cache
    
    try:
        # Free API endpoint - no key required for basic usage
        # Alternative: https://api.exchangerate-api.com/v4/latest/GBP
        response = requests.get(
            'https://open.er-api.com/v6/latest/GBP',
            timeout=5
        )
        response.raise_for_status()
        data = response.json()
        
        if data.get('result') == 'success' or 'rates' in data:
            rates = data['rates']
            _rates_cache = rates
            _cache_timestamp = datetime.now()
            logger.info(f"✅ Fetched fresh exchange rates: USD={rates.get('USD', 'N/A')}, EUR={rates.get('EUR', 'N/A')}")
            return rates
        else:
            raise ValueError("Invalid API response")
            
    except Exception as e:
        logger.warning(f"Failed to fetch exchange rates: {e}")
        
        # Use fallback rates if cache exists
        if _rates_cache:
            logger.info("Using cached exchange rates as fallback")
            return _rates_cache
        
        # Hardcoded fallback rates (approximate as of late 2024)
        fallback_rates = {
            'GBP': 1.0,
            'USD': 1.27,
            'EUR': 1.16,
            'CAD': 1.75,
            'AUD': 1.93,
            'JPY': 189.0,
            'CHF': 1.12,
            'CNY': 9.15,
            'SEK': 13.5,
            'NOK': 13.8,
            'DKK': 8.65,
            'PLN': 5.0,
            'CZK': 29.2,
            'HUF': 460.0
        }
        logger.warning(f"Using hardcoded fallback rates")
        _rates_cache = fallback_rates
        _cache_timestamp = datetime.now()
        return fallback_rates


def convert_to_gbp(amount: float, from_currency: str) -> float:
    """
    Convert an amount from any currency to GBP
    
    Args:
        amount: The amount to convert
        from_currency: The source currency code (e.g., 'USD', 'EUR')
    
    Returns:
        The amount in GBP
    """
    if not amount or not from_currency:
        return amount
    
    from_currency = from_currency.upper().strip()
    
    # Already in GBP - no conversion needed
    if from_currency == 'GBP':
        return amount
    
    try:
        rates = get_exchange_rates()
        rate = rates.get(from_currency)
        
        if not rate:
            logger.warning(f"No exchange rate found for {from_currency}, returning original amount")
            return amount
        
        # Convert to GBP: divide by the rate (since rates are GBP to X)
        gbp_amount = amount / rate
        return round(gbp_amount, 2)
        
    except Exception as e:
        logger.error(f"Error converting {from_currency} to GBP: {e}")
        return amount


def convert_to_eur(amount: float, from_currency: str) -> float:
    """
    Convert an amount from any currency to EUR
    
    Args:
        amount: The amount to convert
        from_currency: The source currency code (e.g., 'USD', 'GBP')
    
    Returns:
        The amount in EUR
    """
    if not amount or not from_currency:
        return amount
    
    from_currency = from_currency.upper().strip()
    
    # Already in EUR
    if from_currency == 'EUR':
        return amount
    
    try:
        rates = get_exchange_rates()
        
        # First convert to GBP, then to EUR
        if from_currency == 'GBP':
            gbp_amount = amount
        else:
            rate_from = rates.get(from_currency)
            if not rate_from:
                logger.warning(f"No exchange rate found for {from_currency}, returning original amount")
                return amount
            gbp_amount = amount / rate_from
        
        # Convert GBP to EUR
        eur_rate = rates.get('EUR')
        if not eur_rate:
            logger.warning(f"No EUR exchange rate found, returning original amount")
            return amount
        
        eur_amount = gbp_amount * eur_rate
        return round(eur_amount, 2)
        
    except Exception as e:
        logger.error(f"Error converting {from_currency} to EUR: {e}")
        return amount


def get_rate_for_display(from_currency: str, to_currency: str) -> Optional[float]:
    """
    Get the exchange rate for display purposes
    
    Args:
        from_currency: Source currency code
        to_currency: Target currency code
    
    Returns:
        The exchange rate or None if not found
    """
    try:
        rates = get_exchange_rates()
        
        if from_currency == to_currency:
            return 1.0
        
        # Get both rates relative to GBP
        if from_currency == 'GBP':
            from_rate = 1.0
        else:
            from_rate = rates.get(from_currency.upper())
            
        if to_currency == 'GBP':
            to_rate = 1.0
        else:
            to_rate = rates.get(to_currency.upper())
        
        if from_rate and to_rate:
            # Convert from source to GBP, then GBP to target
            rate = to_rate / from_rate
            return round(rate, 4)
        
        return None
        
    except Exception as e:
        logger.error(f"Error getting exchange rate: {e}")
        return None
