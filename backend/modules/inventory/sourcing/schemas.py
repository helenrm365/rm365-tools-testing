# backend/modules/inventory/sourcing/schemas.py
"""
Pydantic schemas for Product Sourcing module
"""
from typing import Optional, List, Dict, Any
from datetime import datetime
from pydantic import BaseModel, Field, model_validator


# ============================================================================
# FX RATES SCHEMAS
# ============================================================================

class FXRateOut(BaseModel):
    """Single exchange rate entry"""
    currency_code: str = Field(..., description="Currency code (e.g., USD, EUR)")
    rate: float = Field(..., description="Exchange rate to base currency")
    last_updated: Optional[datetime] = None


class FXRatesResponse(BaseModel):
    """Complete FX rates response"""
    base_currency: str = Field(default="GBP", description="Base currency code")
    rates: Dict[str, float] = Field(default_factory=dict)
    last_updated: Optional[datetime] = None
    source: str = Field(default="api", description="Rate source (api, fallback, manual)")


class FXRateManualIn(BaseModel):
    """Manual FX rate override"""
    currency_code: str
    rate: float
    notes: Optional[str] = None


# ============================================================================
# SUPPLIER SCHEMAS
# ============================================================================

class SupplierBase(BaseModel):
    """Base supplier information"""
    name: str = Field(..., min_length=1, max_length=100)
    code: str = Field(..., min_length=1, max_length=20, description="Short code for supplier")
    default_currency: str = Field(default="GBP", max_length=3)
    contact_email: Optional[str] = None
    contact_phone: Optional[str] = None
    website: Optional[str] = None
    notes: Optional[str] = None
    is_active: bool = True
    lead_time_days: Optional[int] = None
    min_order_value: Optional[float] = None
    payment_terms: Optional[str] = None


class SupplierCreateIn(SupplierBase):
    """Create new supplier"""
    pass


class SupplierUpdateIn(BaseModel):
    """Update existing supplier"""
    name: Optional[str] = None
    code: Optional[str] = None
    default_currency: Optional[str] = None
    contact_email: Optional[str] = None
    contact_phone: Optional[str] = None
    website: Optional[str] = None
    notes: Optional[str] = None
    is_active: Optional[bool] = None
    lead_time_days: Optional[int] = None
    min_order_value: Optional[float] = None
    payment_terms: Optional[str] = None


class SupplierOut(SupplierBase):
    """Supplier output with ID"""
    id: int
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# ============================================================================
# SUPPLIER PRICING SCHEMAS
# ============================================================================

class SupplierPricingBase(BaseModel):
    """Base supplier pricing for a product"""
    sku: str = Field(..., description="Product SKU")
    supplier_id: int
    unit_price: float = Field(..., ge=0)
    currency: Optional[str] = Field(None, max_length=3, description="Currency code. If None, supplier's default currency will be used.")
    moq: Optional[int] = Field(None, description="Minimum Order Quantity")
    shipping_cost: Optional[float] = Field(None, ge=0)
    notes: Optional[str] = None
    is_preferred: bool = False
    last_verified: Optional[datetime] = None


class SupplierPricingCreateIn(SupplierPricingBase):
    """Create supplier pricing entry"""
    pass


class SupplierPricingUpdateIn(BaseModel):
    """Update supplier pricing"""
    unit_price: Optional[float] = None
    currency: Optional[str] = None
    moq: Optional[int] = None
    shipping_cost: Optional[float] = None
    notes: Optional[str] = None
    is_preferred: Optional[bool] = None


class SupplierPricingOut(SupplierPricingBase):
    """Supplier pricing output"""
    id: int
    supplier_name: Optional[str] = None
    supplier_code: Optional[str] = None
    normalized_price_gbp: Optional[float] = None
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# ============================================================================
# SUPPLIER MATRIX (BULK) SCHEMAS
# ============================================================================

class SupplierMatrixEntry(BaseModel):
    """Single entry in supplier matrix for a product"""
    supplier_id: int
    supplier_code: str
    supplier_name: str
    unit_price: Optional[float] = None
    currency: str = "GBP"
    normalized_price_gbp: Optional[float] = None
    moq: Optional[int] = None
    shipping_cost: Optional[float] = None
    notes: Optional[str] = None
    is_preferred: bool = False
    last_verified: Optional[datetime] = None


class SupplierMatrixRow(BaseModel):
    """Complete supplier matrix row for one SKU"""
    sku: str
    product_name: Optional[str] = None
    category: Optional[str] = None
    magento_price: Optional[float] = None
    stock_level: Optional[int] = None
    suppliers: List[SupplierMatrixEntry] = []


class SupplierMatrixBulkUpdateIn(BaseModel):
    """Bulk update supplier pricing from matrix view"""
    updates: List[Dict[str, Any]] = Field(
        ..., 
        description="List of {sku, supplier_id, unit_price, currency, moq, shipping_cost, notes}"
    )


# ============================================================================
# ANALYSIS DASHBOARD SCHEMAS
# ============================================================================

class AnalysisProductRow(BaseModel):
    """Single product analysis row with all supplier comparisons"""
    sku: str
    product_name: Optional[str] = None
    category: Optional[str] = None
    brand: Optional[str] = None
    magento_price: Optional[float] = None
    stock_level: Optional[int] = None
    
    # Supplier prices (normalized to GBP)
    supplier_prices: Dict[str, Optional[float]] = Field(
        default_factory=dict,
        description="Mapping of supplier_code -> normalized GBP price"
    )
    
    # Calculated fields
    best_price: Optional[float] = None
    winning_supplier: Optional[str] = None
    margin_percentage: Optional[float] = None
    margin_status: Optional[str] = Field(
        None, 
        description="'healthy', 'warning', 'loss', or 'no_data'"
    )
    
    # Additional metadata
    supplier_count: int = 0
    last_price_update: Optional[datetime] = None


class AnalysisFilters(BaseModel):
    """Filters for analysis dashboard"""
    search: Optional[str] = None
    category: Optional[str] = None
    brand: Optional[str] = None
    supplier_id: Optional[int] = None
    margin_status: Optional[str] = None  # healthy, warning, loss
    has_pricing: Optional[bool] = None
    min_margin: Optional[float] = None
    max_margin: Optional[float] = None


class AnalysisSummary(BaseModel):
    """Summary statistics for analysis dashboard"""
    total_products: int = 0
    products_with_pricing: int = 0
    products_needing_review: int = 0
    average_margin: Optional[float] = None
    best_margins: List[Dict[str, Any]] = []
    worst_margins: List[Dict[str, Any]] = []
    supplier_breakdown: Dict[str, int] = Field(
        default_factory=dict,
        description="Count of products where each supplier is cheapest"
    )


class AnalysisDashboardResponse(BaseModel):
    """Complete analysis dashboard response"""
    products: List[AnalysisProductRow]
    summary: AnalysisSummary
    filters_applied: AnalysisFilters
    total: int
    page: int
    per_page: int
    total_pages: int


class GoogleSheetSyncRequest(BaseModel):
    sheet_id: str


# ============================================================================
# PDF IMPORT SCHEMAS
# ============================================================================

class PdfImportPreviewItem(BaseModel):
    """A single matched item from a PDF import preview"""
    sku: str
    supplier_product_name: str
    current_price: Optional[float] = None
    current_currency: str = "GBP"
    new_price: float
    new_currency: str = "GBP"
    match_method: str = Field(..., description="'mapping', 'direct_sku', or 'product_name'")
    has_change: bool


class PdfImportUnmatchedItem(BaseModel):
    """A line extracted from the PDF that could not be matched to any product"""
    raw_text: str
    price: float
    currency: Optional[str] = None
    reason: str


class PdfImportConflictItem(BaseModel):
    """
    Both the reference code and the designation matched, but to different internal SKUs.
    The user must choose which product to associate this price with.
    """
    ref: str
    identifier: str
    price: float
    currency: str
    sku_from_ref: str
    product_name_from_ref: Optional[str] = None
    sku_from_name: str
    product_name_from_name: Optional[str] = None


class PdfImportPreviewResponse(BaseModel):
    """Full preview returned after parsing a supplier PDF — no DB changes yet"""
    supplier_id: int
    supplier_name: str
    supplier_code: str
    supplier_default_currency: str
    preview: List[PdfImportPreviewItem]
    conflicts: List[PdfImportConflictItem]
    unmatched: List[PdfImportUnmatchedItem]
    total_found: int
    total_matched: int
    total_conflicts: int
    total_unmatched: int


# ============================================================================
# SUPPLIER PRODUCT MAPPING SCHEMAS
# ============================================================================

class SupplierProductMappingCreateIn(BaseModel):
    """Create a new supplier product mapping — at least one of supplier_sku or supplier_product_name required"""
    supplier_id: int
    supplier_sku: Optional[str] = Field(None, max_length=255, description="Supplier's product SKU/code")
    supplier_product_name: Optional[str] = Field(None, max_length=255, description="Supplier's product name")
    internal_sku: str = Field(..., min_length=1, max_length=100, description="Internal matching SKU")

    @model_validator(mode='after')
    def at_least_one_identifier(self):
        sku = (self.supplier_sku or '').strip()
        name = (self.supplier_product_name or '').strip()
        if not sku and not name:
            raise ValueError("At least one of supplier_sku or supplier_product_name must be provided")
        return self


class SupplierProductMappingOut(BaseModel):
    """Supplier product mapping output"""
    id: int
    supplier_id: int
    supplier_code: Optional[str] = None
    supplier_name: Optional[str] = None
    supplier_sku: Optional[str] = None
    supplier_product_name: Optional[str] = None
    internal_sku: str
    internal_product_name: Optional[str] = None
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True

