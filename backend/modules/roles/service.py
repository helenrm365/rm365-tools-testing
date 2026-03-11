from typing import List, Optional
from .repo import RolesRepo
from modules.users.service import UsersService

def _csv(arr: Optional[List[str]]) -> str:
    return ",".join([t.strip() for t in (arr or []) if t and t.strip()])

def _csv_to_list(csv_str: str) -> List[str]:
    return [t.strip() for t in (csv_str or "").split(",") if t.strip()]

class RolesService:
    def __init__(self, repo: Optional[RolesRepo] = None):
        self.repo = repo or RolesRepo()
        self._users_svc = None

    @property
    def users_svc(self):
        if self._users_svc is None:
            self._users_svc = UsersService()
        return self._users_svc

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
        """Update an existing role and sync tabs to all users with this role"""
        self.repo.update(
            role_name,
            new_role_name=new_role_name,
            allowed_tabs_csv=_csv(allowed_tabs) if allowed_tabs is not None else None
        )
        # Sync tab access to all users with this role (skip admin and custom — they have special handling)
        effective_name = new_role_name if new_role_name else role_name
        if allowed_tabs is not None and effective_name.lower() not in ('admin', 'custom'):
            self.users_svc.update_tabs_for_role(effective_name, allowed_tabs)

    def delete(self, role_name: str):
        """Delete a role"""
        self.repo.delete(role_name)
