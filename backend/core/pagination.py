from math import ceil
from typing import Generic, List, Optional, Sequence, TypeVar
from fastapi import Query, Depends
from pydantic import BaseModel, Field

T = TypeVar('T')

# Query params (page-based; switch to offset-based by changing fields)
class PageParams(BaseModel):
    page: int = Field(1, ge=1)
    size: int = Field(50, ge=1, le=200)  # clamp with sensible max

def get_page_params(
    page: int = Query(1, ge=1),
    size: int = Query(50, ge=1, le=200),
) -> PageParams:
    return PageParams(page=page, size=size)

class Page(BaseModel, Generic[T]):
    items: List[T]
    total: int
    page: int
    size: int
    pages: int

    @property
    def has_next(self) -> bool:
        return self.page < self.pages

    @property
    def has_prev(self) -> bool:
        return self.page > 1

def to_page(
    *,
    items: Sequence[T],
    total: int,
    params: PageParams,
) -> Page[T]:
    pages = max(1, ceil(total / params.size))
    return Page[T](
        items=list(items),
        total=total,
        page=params.page,
        size=params.size,
        pages=pages,
    )

# Convenience helpers
def limit_offset(params: PageParams) -> tuple[int, int]:
    limit = params.size
    offset = (params.page - 1) * params.size
    return limit, offset
