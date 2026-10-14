"""
Milestone template data access. A template's milestones are always read and
written together with it.
"""

from repository.base import Repository, where

ITEM_COLUMNS = ["id", "template_id", "sequence", "title", "description", "duration_days"]


class MilestoneTemplateRepository(Repository):
    table = "milestone_templates"
    columns = ["id", "name", "description", "manager_id", "created_at", "updated_at"]

    def _with_items(self, templates: list[dict]) -> list[dict]:
        if not templates:
            return []
        items = self.db.execute(
            f"SELECT {self._select(ITEM_COLUMNS)} FROM milestone_template_items "
            f"WHERE template_id = ANY(%s) ORDER BY sequence",
            ([t["id"] for t in templates],),
        ).fetchall()
        for template in templates:
            template["milestones"] = [item for item in items if item["template_id"] == template["id"]]
        return templates

    def _replace_items(self, template_id: int, items: list[dict]) -> None:
        self.db.execute("DELETE FROM milestone_template_items WHERE template_id = %s", (template_id,))
        for sequence, item in enumerate(items, start=1):
            self._insert({"template_id": template_id, "sequence": sequence, **item}, "milestone_template_items", ["id"])

    def create(self, values: dict, items: list[dict]) -> dict:
        with self.transaction():
            template_id = self._insert(values)["id"]
            self._replace_items(template_id, items)
        return self.get(template_id)

    def get(self, template_id: int) -> dict | None:
        row = self._get(template_id)
        return self._with_items([row])[0] if row else None

    def find(self, manager_id: str | None = None, q: str | None = None) -> list[dict]:
        conditions, params = [], []
        if manager_id:
            conditions.append("manager_id = %s")
            params.append(manager_id)
        if q:
            conditions.append("name ILIKE %s")
            params.append(f"%{q}%")
        rows = self.db.execute(
            f"SELECT {self._select()} FROM milestone_templates{where(conditions)} ORDER BY lower(name)", params
        ).fetchall()
        return self._with_items(rows)

    def update(self, template_id: int, values: dict, items: list[dict] | None) -> dict:
        with self.transaction():
            self._update(template_id, values)
            if items is not None:
                self._replace_items(template_id, items)
        return self.get(template_id)

    def delete(self, template_id: int) -> bool:
        return self._delete(template_id)
