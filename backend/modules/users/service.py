from typing import List, Optional
from core.security import hash_password
from .repo import UsersRepo

def _csv(arr: Optional[List[str]]) -> str:
    return ",".join([t.strip() for t in (arr or []) if t and t.strip()])

class UsersService:
    def __init__(self, repo: Optional[UsersRepo] = None):
        self.repo = repo or UsersRepo()

    def ensure_unique(self, username: str):
        if self.repo.get(username):
            raise ValueError("Username already exists")

    def _save_role_preset(self, role: str, allowed_tabs: List[str]):
        """Save/update role in roles table for future use"""
        try:
            from modules.roles.service import RolesService
            roles_svc = RolesService()
            roles_svc.upsert(role, allowed_tabs)
        except Exception as e:
            print(f"[Users] Warning: Could not save role preset: {e}")

    def create(self, username: str, password: str, role: str, allowed_tabs: List[str]):
        self.ensure_unique(username)
        self.repo.create(username, hash_password(password), role, _csv(allowed_tabs))
        # Save role as preset
        if role:
            self._save_role_preset(role, allowed_tabs)

    def update(self, username: str, *, new_username=None, new_password=None, role=None, allowed_tabs=None):
        new_hash = hash_password(new_password) if new_password else None
        self.repo.update(username, new_username=new_username, new_hash=new_hash, role=role,
                         allowed_tabs_csv=_csv(allowed_tabs) if allowed_tabs is not None else None)
        # Save role as preset if both role and tabs are provided
        if role and allowed_tabs is not None:
            self._save_role_preset(role, allowed_tabs)

    def delete(self, username: str):
        self.repo.delete(username)

    def list_usernames(self) -> List[str]:
        return self.repo.list_usernames()

    def list_all(self) -> List[dict]:
        """Get all users with their details (excluding password hashes)"""
        rows = self.repo.list_all()
        users = []
        for username, role, allowed_tabs_csv in rows:
            allowed_tabs = [t.strip() for t in (allowed_tabs_csv or "").split(",") if t.strip()]
            users.append({
                "username": username,
                "role": role or "user",
                "allowed_tabs": allowed_tabs
            })
        return users
