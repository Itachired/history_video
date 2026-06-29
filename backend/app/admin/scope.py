from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Sequence, Tuple


@dataclass(frozen=True)
class AdminDataScope:
    level: str
    user_id: Optional[int]
    tenant_ids: Tuple[str, ...]
    workspace_ids: Tuple[str, ...]

    @property
    def is_all(self) -> bool:
        return self.level == "all"


def _unique(values: Sequence[Any]) -> Tuple[str, ...]:
    seen = set()
    result: List[str] = []
    for value in values:
        text = str(value or "").strip()
        if text and text not in seen:
            seen.add(text)
            result.append(text)
    return tuple(result)


def data_scope_for_user(user: Dict[str, Any]) -> AdminDataScope:
    user_id = int(user.get("id") or 0) or None
    if user.get("is_super_admin"):
        return AdminDataScope("all", user_id, tuple(), tuple())

    role_codes = {role.get("code") for role in user.get("roles", []) if role.get("code")}
    tenant_ids = _unique(
        [item.get("tenant_id") for item in user.get("tenants", [])]
        + [user.get("default_tenant_id")]
    )
    workspace_ids = _unique(
        [item.get("workspace_id") for item in user.get("workspaces", [])]
        + [user.get("default_workspace_id")]
    )

    if "admin" in role_codes:
        return AdminDataScope("tenant", user_id, tenant_ids, workspace_ids)
    if "operator" in role_codes or "viewer" in role_codes:
        return AdminDataScope("workspace", user_id, tenant_ids, workspace_ids)
    if tenant_ids and not workspace_ids:
        return AdminDataScope("tenant", user_id, tenant_ids, workspace_ids)
    return AdminDataScope("workspace", user_id, tenant_ids, workspace_ids)


def record_in_scope(record: Optional[Dict[str, Any]], scope: AdminDataScope) -> bool:
    if not record:
        return False
    if scope.is_all:
        return True

    tenant_id = record.get("tenant_id") or ""
    workspace_id = record.get("workspace_id") or ""
    user_id = scope.user_id
    owner_ids = {
        record.get("owner_user_id"),
        record.get("created_by_user_id"),
        record.get("creator_user_id"),
        record.get("user_id"),
    }
    if user_id and any(str(owner_id or "") == str(user_id) for owner_id in owner_ids):
        return True

    if scope.level == "tenant":
        return bool(tenant_id and tenant_id in scope.tenant_ids)
    if scope.level == "workspace":
        return bool(workspace_id and workspace_id in scope.workspace_ids)
    if scope.level == "owned":
        return False
    return False


def filter_records_by_scope(records: Sequence[Dict[str, Any]], scope: AdminDataScope) -> List[Dict[str, Any]]:
    if scope.is_all:
        return list(records)
    return [record for record in records if record_in_scope(record, scope)]


def scoped_sql_condition(
    scope: Optional[AdminDataScope],
    alias: str = "",
    owner_columns: Sequence[str] = (),
    user_column: str = "",
) -> Tuple[str, List[Any]]:
    if not scope or scope.is_all:
        return "", []

    prefix = f"{alias}." if alias else ""

    clauses: List[str] = []
    params: List[Any] = []

    if scope.level == "tenant" and scope.tenant_ids:
        placeholders = ", ".join(["?"] * len(scope.tenant_ids))
        clauses.append(f"{prefix}tenant_id IN ({placeholders})")
        params.extend(scope.tenant_ids)
    elif scope.level == "workspace" and scope.workspace_ids:
        placeholders = ", ".join(["?"] * len(scope.workspace_ids))
        clauses.append(f"{prefix}workspace_id IN ({placeholders})")
        params.extend(scope.workspace_ids)

    if scope.user_id:
        for column in owner_columns:
            clauses.append(f"{column} = ?")
            params.append(scope.user_id)
        if user_column:
            clauses.append(f"{user_column} = ?")
            params.append(scope.user_id)

    if not clauses:
        return "1 = 0", []
    return "(" + " OR ".join(clauses) + ")", params
