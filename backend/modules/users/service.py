from typing import List, Optional, Dict
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

    def create(self, username: str, password: str, role: str, allowed_tabs: List[str], location_id: int = None, group_id: int = None):
        self.ensure_unique(username)
        self.repo.create(username, hash_password(password), role, _csv(allowed_tabs), location_id, group_id)

    def update(self, username: str, *, new_username=None, new_password=None, role=None, allowed_tabs=None, location_id=None, clear_location=False, clear_role=False, group_id=None, clear_group=False):
        new_hash = hash_password(new_password) if new_password else None
        self.repo.update(username, new_username=new_username, new_hash=new_hash, role=role,
                         clear_role=clear_role,
                         allowed_tabs_csv=_csv(allowed_tabs) if allowed_tabs is not None else None,
                         location_id=location_id, clear_location=clear_location,
                         group_id=group_id, clear_group=clear_group)

    def update_tabs_for_role(self, role_name: str, allowed_tabs: List[str]):
        """Sync allowed_tabs for all users with a given role"""
        self.repo.update_tabs_for_role(role_name, _csv(allowed_tabs))

    def delete(self, username: str):
        self.repo.delete(username)

    def list_usernames(self) -> List[str]:
        return self.repo.list_usernames()

    def list_all(self) -> List[dict]:
        """Get all users with their details (excluding password hashes)"""
        rows = self.repo.list_all()
        users = []
        for row in rows:
            username, role, allowed_tabs_csv = row[0], row[1], row[2]
            location_id = row[3] if len(row) > 3 else None
            group_id = row[4] if len(row) > 4 else None
            allowed_tabs = [t.strip() for t in (allowed_tabs_csv or "").split(",") if t.strip()]
            users.append({
                "username": username,
                "role": role or None,
                "allowed_tabs": allowed_tabs,
                "location_id": location_id,
                "group_id": group_id
            })
        return users

    # ===== User Preferences =====
    def get_preferences(self, username: str) -> Dict:
        """Get user appearance preferences with defaults"""
        prefs = self.repo.get_preferences(username)
        # Return defaults if no preferences saved
        return prefs or {
            "dark_mode": False,
            "accent_enabled": False,
            "accent_color": "#8bc34a",
            "accent_dark": "#7ab82d",
            "accent_light": "#a5d461"
        }

    def save_preferences(self, username: str, preferences: Dict) -> Dict:
        """Save user appearance preferences. Returns the saved preferences."""
        success = self.repo.save_preferences(username, preferences)
        if not success:
            # User doesn't exist in database (e.g., superadmin)
            # Log this but still return success - frontend will use localStorage
            print(f"⚠️  Could not save preferences for user '{username}' - user may not exist in database")
        return preferences
