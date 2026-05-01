from typing import List, Optional
from .repo import TabPresetsRepo
from modules.users.service import UsersService


def _csv(arr: Optional[List[str]]) -> str:
    return ",".join([t.strip() for t in (arr or []) if t and t.strip()])


def _csv_to_list(csv_str: str) -> List[str]:
    return [t.strip() for t in (csv_str or "").split(",") if t.strip()]


class TabPresetsService:
    def __init__(self, repo: Optional[TabPresetsRepo] = None):
        self.repo = repo or TabPresetsRepo()
        self._users_svc = None

    @property
    def users_svc(self):
        if self._users_svc is None:
            self._users_svc = UsersService()
        return self._users_svc

    def init_tab_presets_table(self):
        """Initialize tab_presets table with system defaults."""
        self.repo.init_table()

    def list_all(self) -> List[dict]:
        """Get all tab presets."""
        rows = self.repo.list_all()
        presets = []
        for preset_id, preset_name, allowed_tabs_csv, created_at, updated_at in rows:
            presets.append({
                "id": preset_id,
                "preset_name": preset_name,
                "allowed_tabs": _csv_to_list(allowed_tabs_csv),
                "created_at": created_at,
                "updated_at": updated_at,
            })
        return presets

    def get_by_name(self, preset_name: str) -> Optional[dict]:
        """Get a specific preset by name."""
        row = self.repo.get_by_name(preset_name)
        if not row:
            return None
        preset_id, preset_name, allowed_tabs_csv = row
        return {
            "id": preset_id,
            "preset_name": preset_name,
            "allowed_tabs": _csv_to_list(allowed_tabs_csv),
        }

    def create(self, preset_name: str, allowed_tabs: List[str]):
        """Create a new tab preset."""
        if self.repo.get_by_name(preset_name):
            raise ValueError("Tab preset already exists")
        return self.repo.create(preset_name, _csv(allowed_tabs))

    def update(self, preset_name: str, *, new_preset_name=None, allowed_tabs=None):
        """Update an existing preset and sync allowed_tabs to all users using it."""
        self.repo.update(
            preset_name,
            new_preset_name=new_preset_name,
            allowed_tabs_csv=_csv(allowed_tabs) if allowed_tabs is not None else None,
        )
        # Sync tab access to all users assigned to this preset (skip admin/custom — special handling)
        effective_name = new_preset_name if new_preset_name else preset_name
        if allowed_tabs is not None and effective_name.lower() not in ("admin", "custom"):
            self.users_svc.update_tabs_for_preset(effective_name, allowed_tabs)

    def delete(self, preset_name: str):
        """Delete a tab preset."""
        self.repo.delete(preset_name)
