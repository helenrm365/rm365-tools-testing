"""
Pydantic schemas for Product Sourcing module
"""
from __future__ import annotations
from datetime import date, datetime
from typing import Optional, List
from decimal import Decimal
from pydantic import BaseModel, Field


# ====== Supplier Schemas ======
class SupplierBase(BaseModel):
    """Base schema for supplier"""
    name: str = Field(..., min_length=1, max_length=255, description="Supplier company name")
    code: Optional[str] = Field(None, max_length=50, description="Short supplier code for reference")
    contact_email: Optional[str] = Field(None, max_length=255)
    contact_phone: Optional[str] = Field(None, max_length=50)
    website: Optional[str] = Field(None, max_length=255)
    notes: Optional[str] = None
    is_active: bool = Field(True, description="Whether supplier is currently active")


class SupplierCreateIn(SupplierBase):
    """Schema for creating a new supplier"""
    pass


class SupplierUpdateIn(BaseModel):
    """Schema for updating an existing supplier"""
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    code: Optional[str] = Field(None, max_length=50)
    contact_email: Optional[str] = Field(None, max_length=255)
    contact_phone: Optional[str] = Field(None, max_length=50)
    website: Optional[str] = Field(None, max_length=255)
    notes: Optional[str] = None
    is_active: Optional[bool] = None


class SupplierOut(SupplierBase):
    """Schema for supplier output"""
    id: int
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


# ====== Supplier Product (SKU Mapping) Schemas ======
class SupplierProductBase(BaseModel):
    """Base schema for supplier product mapping"""
    supplier_id: int = Field(..., description="ID of the supplier")
    supplier_sku: str = Field(..., min_length=1, max_length=100, description="Supplier's SKU for this product")
    supplier_product_name: str = Field(..., min_length=1, max_length=500, description="Supplier's name for this product")
    internal_sku: Optional[str] = Field(None, max_length=100, description="Our internal SKU (maps to inventory_metadata)")
    pack_size: int = Field(1, ge=1, description="Pack size / units per purchase")
    notes: Optional[str] = None
    is_active: bool = Field(True, description="Whether this mapping is currently active")


class SupplierProductCreateIn(SupplierProductBase):
    """Schema for creating a new supplier product mapping"""
    pass


class SupplierProductUpdateIn(BaseModel):
    """Schema for updating a supplier product mapping"""
    supplier_sku: Optional[str] = Field(None, min_length=1, max_length=100)
    supplier_product_name: Optional[str] = Field(None, min_length=1, max_length=500)
    internal_sku: Optional[str] = Field(None, max_length=100)
    pack_size: Optional[int] = Field(None, ge=1)
    notes: Optional[str] = None
    is_active: Optional[bool] = None


class SupplierProductOut(SupplierProductBase):
    """Schema for supplier product output"""
    id: int
    supplier_name: Optional[str] = None  # Populated from join
    current_buy_price: Optional[Decimal] = None  # Latest price from price history
    currency: Optional[str] = None  # Currency of the current price
    current_price_date: Optional[date] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


# ====== Supplier Price Schemas ======
class SupplierPriceBase(BaseModel):
    """Base schema for supplier price entry"""
    supplier_product_id: int = Field(..., description="ID of the supplier product mapping")
    buy_price: Decimal = Field(..., ge=0, decimal_places=4, description="Purchase price per unit")
    currency: str = Field("GBP", max_length=3, description="Currency code (ISO 4217)")
    effective_date: date = Field(..., description="Date this price becomes effective")
    notes: Optional[str] = None


class SupplierPriceCreateIn(SupplierPriceBase):
    """Schema for creating a new price entry"""
    pass


class SupplierPriceOut(SupplierPriceBase):
    """Schema for price entry output"""
    id: int
    created_by: Optional[str] = None
    created_at: datetime
    import_batch_id: Optional[int] = None

    class Config:
        from_attributes = True


# ====== Price Import Schemas ======
class PriceImportBase(BaseModel):
    """Base schema for price import batch"""
    supplier_id: int = Field(..., description="ID of the supplier for this import")
    import_source: str = Field(..., description="Source of import: 'csv', 'manual', 'api'")
    filename: Optional[str] = Field(None, max_length=500, description="Original filename if CSV")
    notes: Optional[str] = None


class PriceImportCreateIn(PriceImportBase):
    """Schema for creating a new import batch"""
    pass


class PriceImportOut(PriceImportBase):
    """Schema for import batch output"""
    id: int
    status: str  # 'pending', 'processing', 'completed', 'failed'
    total_rows: int = 0
    processed_rows: int = 0
    error_rows: int = 0
    created_by: Optional[str] = None
    created_at: datetime
    completed_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# ====== Comparison / Reporting Schemas ======
class SupplierPriceComparison(BaseModel):
    """Schema for supplier price comparison per internal product"""
    internal_sku: str
    internal_product_name: str
    current_stock: int = 0
    magento_sell_price: Optional[Decimal] = None
    suppliers: List["SupplierPriceDetail"] = []
    cheapest_supplier_id: Optional[int] = None
    cheapest_buy_price: Optional[Decimal] = None
    best_margin: Optional[Decimal] = None
    best_margin_percent: Optional[float] = None


class SupplierPriceDetail(BaseModel):
    """Detail for each supplier in comparison"""
    supplier_id: int
    supplier_name: str
    supplier_sku: str
    buy_price: Decimal
    effective_date: date
    margin: Optional[Decimal] = None
    margin_percent: Optional[float] = None
    is_cheapest: bool = False
    rank: int = 1  # 1 = cheapest, 2 = 2nd cheapest, etc.


class MarginReportItem(BaseModel):
    """Schema for margin report items"""
    internal_sku: str
    internal_product_name: str
    cheapest_buy_price: Decimal
    sell_price: Decimal
    margin: Decimal
    margin_percent: float
    stock_level: int
    best_supplier_name: str


# Allow forward references
SupplierPriceComparison.model_rebuild()
