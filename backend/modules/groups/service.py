from typing import List, Optional
from .repo import GroupsRepo


class GroupsService:
    def __init__(self, repo: Optional[GroupsRepo] = None):
        self.repo = repo or GroupsRepo()

    def init_groups_table(self):
        """Initialize groups table"""
        self.repo.init_table()

    def list_all(self) -> List[dict]:
        """Get all groups"""
        rows = self.repo.list_all()
        return [
            {
                "id": row[0],
                "group_name": row[1],
                "created_at": row[2],
                "updated_at": row[3],
            }
            for row in rows
        ]

    def create(self, group_name: str) -> int:
        if self.repo.get_by_name(group_name):
            raise ValueError("Group already exists")
        return self.repo.create(group_name)

    def update(self, group_id: int, new_name: str):
        existing = self.repo.get_by_name(new_name)
        if existing and existing[0] != group_id:
            raise ValueError("A group with that name already exists")
        self.repo.update(group_id, new_name)

    def delete(self, group_id: int):
        self.repo.delete(group_id)
