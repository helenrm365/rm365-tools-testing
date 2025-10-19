from typing import List, Optional
from .repo import RolesRepo

def _csv(arr: Optional[List[str]]) -> str:
    return ",".join([t.strip() for t in (arr or []) if t and t.strip()])

def _csv_to_list(csv_str: str) -> List[str]:
    return [t.strip() for t in (csv_str or "").split(",") if t.strip()]

class RolesService:
    def __init__(self, repo: Optional[RolesRepo] = None):
        self.repo = repo or RolesRepo()

    def init_roles_table(self):
        """Initialize roles table with defaults"""
        self.repo.init_table()

    def list_all(self) -> List[dict]:
        """Get all roles"""
        rows = self.repo.list_all()
        roles = []
        for role_id, role_name, allowed_tabs_csv, created_at, updated_at in rows:
            roles.append({
                "id": role_id,
                "role_name": role_name,
                "allowed_tabs": _csv_to_list(allowed_tabs_csv),
                "created_at": created_at,
                "updated_at": updated_at
            })
        return roles

    def get_by_name(self, role_name: str) -> Optional[dict]:
        """Get a specific role by name"""
        row = self.repo.get_by_name(role_name)
        if not row:
            return None
        role_id, role_name, allowed_tabs_csv = row
        return {
            "id": role_id,
            "role_name": role_name,
            "allowed_tabs": _csv_to_list(allowed_tabs_csv)
        }

    def create(self, role_name: str, allowed_tabs: List[str]):
        """Create a new role"""
        if self.repo.get_by_name(role_name):
            raise ValueError("Role already exists")
        return self.repo.create(role_name, _csv(allowed_tabs))

    def update(self, role_name: str, *, new_role_name=None, allowed_tabs=None):
        """Update an existing role"""
        self.repo.update(
            role_name,
            new_role_name=new_role_name,
            allowed_tabs_csv=_csv(allowed_tabs) if allowed_tabs is not None else None
        )

    def delete(self, role_name: str):
        """Delete a role"""
        self.repo.delete(role_name)

    def upsert(self, role_name: str, allowed_tabs: List[str]):
        """Insert or update a role"""
        self.repo.upsert(role_name, _csv(allowed_tabs))
