import json
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional

from .config import (
    ADMIN_BOOTSTRAP_DISPLAY_NAME,
    ADMIN_BOOTSTRAP_PASSWORD,
    ADMIN_BOOTSTRAP_USERNAME,
    ADMIN_DATABASE_PATH,
)
from .permissions import PERMISSIONS, ROLE_DEFINITIONS
from .security import hash_password
from .scope import AdminDataScope, scoped_sql_condition

DEFAULT_TENANT_ID = "tenant_default"
DEFAULT_TENANT_NAME = "默认企业"
DEFAULT_WORKSPACE_ID = "workspace_default"
DEFAULT_WORKSPACE_NAME = "默认项目组"


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def row_to_dict(row: sqlite3.Row) -> Dict[str, Any]:
    return {key: row[key] for key in row.keys()}


class AdminRepository:
    def __init__(self, database_path=ADMIN_DATABASE_PATH):
        self.database_path = database_path

    @contextmanager
    def connect(self):
        self.database_path.parent.mkdir(parents=True, exist_ok=True)
        connection = sqlite3.connect(str(self.database_path))
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        try:
            yield connection
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    def init_db(self):
        with self.connect() as connection:
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS users (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    username TEXT NOT NULL UNIQUE,
                    display_name TEXT NOT NULL,
                    email TEXT,
                    phone TEXT,
                    password_hash TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'active',
                    is_super_admin INTEGER NOT NULL DEFAULT 0,
                    default_tenant_id TEXT,
                    default_workspace_id TEXT,
                    last_login_at TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS roles (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    code TEXT NOT NULL UNIQUE,
                    name TEXT NOT NULL,
                    description TEXT,
                    is_system INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS permissions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    code TEXT NOT NULL UNIQUE,
                    name TEXT NOT NULL,
                    resource TEXT NOT NULL,
                    action TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS user_roles (
                    user_id INTEGER NOT NULL,
                    role_id INTEGER NOT NULL,
                    PRIMARY KEY (user_id, role_id),
                    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                    FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE
                );

                CREATE TABLE IF NOT EXISTS role_permissions (
                    role_id INTEGER NOT NULL,
                    permission_id INTEGER NOT NULL,
                    PRIMARY KEY (role_id, permission_id),
                    FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
                    FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE
                );

                CREATE TABLE IF NOT EXISTS tenants (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    tenant_id TEXT NOT NULL UNIQUE,
                    name TEXT NOT NULL,
                    display_name TEXT,
                    status TEXT NOT NULL DEFAULT 'active',
                    billing_mode TEXT NOT NULL DEFAULT 'internal',
                    billing_currency TEXT NOT NULL DEFAULT 'CNY',
                    contact_name TEXT,
                    contact_email TEXT,
                    contact_phone TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS workspaces (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    workspace_id TEXT NOT NULL UNIQUE,
                    tenant_id TEXT NOT NULL,
                    name TEXT NOT NULL,
                    display_name TEXT,
                    description TEXT,
                    status TEXT NOT NULL DEFAULT 'active',
                    billing_mode TEXT NOT NULL DEFAULT 'inherit',
                    monthly_budget_limit REAL NOT NULL DEFAULT 0,
                    created_by_user_id INTEGER,
                    created_by_username TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                CREATE INDEX IF NOT EXISTS idx_workspaces_tenant_id
                    ON workspaces(tenant_id);
                CREATE INDEX IF NOT EXISTS idx_workspaces_status
                    ON workspaces(status);

                CREATE TABLE IF NOT EXISTS tenant_members (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    tenant_id TEXT NOT NULL,
                    user_id INTEGER NOT NULL,
                    role_in_tenant TEXT NOT NULL DEFAULT 'member',
                    status TEXT NOT NULL DEFAULT 'active',
                    joined_at TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    UNIQUE(tenant_id, user_id)
                );

                CREATE INDEX IF NOT EXISTS idx_tenant_members_user_id
                    ON tenant_members(user_id);

                CREATE TABLE IF NOT EXISTS workspace_members (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    workspace_id TEXT NOT NULL,
                    tenant_id TEXT NOT NULL,
                    user_id INTEGER NOT NULL,
                    role_in_workspace TEXT NOT NULL DEFAULT 'operator',
                    status TEXT NOT NULL DEFAULT 'active',
                    joined_at TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    UNIQUE(workspace_id, user_id)
                );

                CREATE INDEX IF NOT EXISTS idx_workspace_members_user_id
                    ON workspace_members(user_id);
                CREATE INDEX IF NOT EXISTS idx_workspace_members_tenant_id
                    ON workspace_members(tenant_id);

                CREATE TABLE IF NOT EXISTS audit_logs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    actor_user_id INTEGER,
                    actor_username TEXT,
                    action TEXT NOT NULL,
                    resource_type TEXT NOT NULL,
                    resource_id TEXT,
                    before_json TEXT,
                    after_json TEXT,
                    ip TEXT,
                    user_agent TEXT,
                    created_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS projects (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    project_id TEXT NOT NULL UNIQUE,
                    name TEXT,
                    owner_user_id INTEGER,
                    owner_username TEXT,
                    owner_display_name TEXT,
                    created_by_user_id INTEGER,
                    created_by_username TEXT,
                    status TEXT NOT NULL DEFAULT 'active',
                    visibility TEXT NOT NULL DEFAULT 'private',
                    project_dir TEXT,
                    manifest_path TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                CREATE INDEX IF NOT EXISTS idx_projects_owner_user_id
                    ON projects(owner_user_id);
                CREATE INDEX IF NOT EXISTS idx_projects_status
                    ON projects(status);

                CREATE TABLE IF NOT EXISTS generation_tasks (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    task_id TEXT NOT NULL UNIQUE,
                    project_id TEXT NOT NULL,
                    creator_user_id INTEGER,
                    creator_username TEXT,
                    task_type TEXT NOT NULL,
                    status TEXT NOT NULL,
                    phase TEXT NOT NULL,
                    progress INTEGER NOT NULL DEFAULT 0,
                    input_summary TEXT,
                    error_code TEXT,
                    error_type TEXT,
                    error_message TEXT,
                    error_detail TEXT,
                    provider TEXT,
                    retryable INTEGER NOT NULL DEFAULT 0,
                    started_at TEXT,
                    finished_at TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    metadata_json TEXT
                );

                CREATE INDEX IF NOT EXISTS idx_generation_tasks_project_id
                    ON generation_tasks(project_id);
                CREATE INDEX IF NOT EXISTS idx_generation_tasks_status
                    ON generation_tasks(status);
                CREATE INDEX IF NOT EXISTS idx_generation_tasks_phase
                    ON generation_tasks(phase);

                CREATE TABLE IF NOT EXISTS generation_task_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    task_id TEXT NOT NULL,
                    project_id TEXT NOT NULL,
                    phase TEXT NOT NULL,
                    status TEXT NOT NULL,
                    message TEXT,
                    asset_id TEXT,
                    error_code TEXT,
                    error_type TEXT,
                    error_message TEXT,
                    started_at TEXT,
                    finished_at TEXT,
                    duration_ms INTEGER,
                    created_at TEXT NOT NULL,
                    metadata_json TEXT,
                    FOREIGN KEY (task_id) REFERENCES generation_tasks(task_id) ON DELETE CASCADE
                );

                CREATE INDEX IF NOT EXISTS idx_generation_task_events_task_id
                    ON generation_task_events(task_id);
                CREATE INDEX IF NOT EXISTS idx_generation_task_events_project_id
                    ON generation_task_events(project_id);

                CREATE TABLE IF NOT EXISTS token_usage_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    event_id TEXT NOT NULL UNIQUE,
                    user_id INTEGER,
                    username TEXT,
                    project_id TEXT,
                    task_id TEXT,
                    phase TEXT,
                    provider TEXT,
                    model TEXT,
                    endpoint_id TEXT,
                    request_id TEXT,
                    prompt_tokens INTEGER NOT NULL DEFAULT 0,
                    completion_tokens INTEGER NOT NULL DEFAULT 0,
                    total_tokens INTEGER NOT NULL DEFAULT 0,
                    cached_tokens INTEGER NOT NULL DEFAULT 0,
                    reasoning_tokens INTEGER NOT NULL DEFAULT 0,
                    status TEXT NOT NULL DEFAULT 'succeeded',
                    error_code TEXT,
                    error_message TEXT,
                    raw_usage_json TEXT,
                    raw_response_meta_json TEXT,
                    started_at TEXT,
                    finished_at TEXT,
                    created_at TEXT NOT NULL
                );

                CREATE INDEX IF NOT EXISTS idx_token_usage_project_id
                    ON token_usage_events(project_id);
                CREATE INDEX IF NOT EXISTS idx_token_usage_task_id
                    ON token_usage_events(task_id);
                CREATE INDEX IF NOT EXISTS idx_token_usage_user_id
                    ON token_usage_events(user_id);
                CREATE INDEX IF NOT EXISTS idx_token_usage_created_at
                    ON token_usage_events(created_at);

                CREATE TABLE IF NOT EXISTS billing_price_rules (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    code TEXT NOT NULL UNIQUE,
                    provider TEXT NOT NULL,
                    model TEXT,
                    endpoint_id TEXT,
                    resource_type TEXT NOT NULL DEFAULT 'llm_token',
                    phase TEXT,
                    input_price_per_1m_tokens REAL NOT NULL DEFAULT 0,
                    output_price_per_1m_tokens REAL NOT NULL DEFAULT 0,
                    cached_input_price_per_1m_tokens REAL NOT NULL DEFAULT 0,
                    reasoning_price_per_1m_tokens REAL NOT NULL DEFAULT 0,
                    currency TEXT NOT NULL DEFAULT 'CNY',
                    enabled INTEGER NOT NULL DEFAULT 1,
                    effective_from TEXT,
                    effective_to TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                CREATE INDEX IF NOT EXISTS idx_billing_price_rules_lookup
                    ON billing_price_rules(provider, endpoint_id, model, resource_type, enabled);

                CREATE TABLE IF NOT EXISTS billing_cost_entries (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    cost_entry_id TEXT NOT NULL UNIQUE,
                    usage_event_id TEXT NOT NULL,
                    user_id INTEGER,
                    username TEXT,
                    project_id TEXT,
                    task_id TEXT,
                    phase TEXT,
                    provider TEXT,
                    model TEXT,
                    prompt_tokens INTEGER NOT NULL DEFAULT 0,
                    completion_tokens INTEGER NOT NULL DEFAULT 0,
                    total_tokens INTEGER NOT NULL DEFAULT 0,
                    cached_tokens INTEGER NOT NULL DEFAULT 0,
                    reasoning_tokens INTEGER NOT NULL DEFAULT 0,
                    input_unit_price REAL NOT NULL DEFAULT 0,
                    output_unit_price REAL NOT NULL DEFAULT 0,
                    cached_input_unit_price REAL NOT NULL DEFAULT 0,
                    reasoning_unit_price REAL NOT NULL DEFAULT 0,
                    input_cost REAL NOT NULL DEFAULT 0,
                    output_cost REAL NOT NULL DEFAULT 0,
                    cached_input_cost REAL NOT NULL DEFAULT 0,
                    reasoning_cost REAL NOT NULL DEFAULT 0,
                    total_cost REAL NOT NULL DEFAULT 0,
                    currency TEXT NOT NULL DEFAULT 'CNY',
                    pricing_rule_id INTEGER,
                    pricing_snapshot_json TEXT,
                    status TEXT NOT NULL DEFAULT 'confirmed',
                    created_at TEXT NOT NULL
                );

                CREATE INDEX IF NOT EXISTS idx_billing_cost_project_id
                    ON billing_cost_entries(project_id);
                CREATE INDEX IF NOT EXISTS idx_billing_cost_task_id
                    ON billing_cost_entries(task_id);
                CREATE INDEX IF NOT EXISTS idx_billing_cost_user_id
                    ON billing_cost_entries(user_id);
                CREATE INDEX IF NOT EXISTS idx_billing_cost_created_at
                    ON billing_cost_entries(created_at);
                """
            )
        self.migrate_db()
        self.seed_defaults()

    def migrate_db(self):
        with self.connect() as connection:
            def add_columns(table: str, additions: Dict[str, str]):
                rows = connection.execute(f"PRAGMA table_info({table})").fetchall()
                columns = {row["name"] for row in rows}
                for column, definition in additions.items():
                    if column not in columns:
                        connection.execute(
                            f"ALTER TABLE {table} ADD COLUMN {column} {definition}"
                        )

            add_columns("users", {
                "default_tenant_id": "TEXT",
                "default_workspace_id": "TEXT",
            })
            add_columns("audit_logs", {
                "tenant_id": "TEXT",
                "workspace_id": "TEXT",
            })
            add_columns("projects", {
                "tenant_id": "TEXT",
                "workspace_id": "TEXT",
            })
            add_columns("generation_tasks", {
                "tenant_id": "TEXT",
                "workspace_id": "TEXT",
            })
            add_columns("generation_task_events", {
                "tenant_id": "TEXT",
                "workspace_id": "TEXT",
            })
            add_columns("token_usage_events", {
                "tenant_id": "TEXT",
                "workspace_id": "TEXT",
            })
            add_columns("billing_price_rules", {
                "tenant_id": "TEXT",
                "workspace_id": "TEXT",
            })
            add_columns("billing_cost_entries", {
                "tenant_id": "TEXT",
                "workspace_id": "TEXT",
                "cached_tokens": "INTEGER NOT NULL DEFAULT 0",
                "reasoning_tokens": "INTEGER NOT NULL DEFAULT 0",
                "cached_input_unit_price": "REAL NOT NULL DEFAULT 0",
                "reasoning_unit_price": "REAL NOT NULL DEFAULT 0",
                "cached_input_cost": "REAL NOT NULL DEFAULT 0",
                "reasoning_cost": "REAL NOT NULL DEFAULT 0",
            })
            connection.executescript(
                """
                CREATE INDEX IF NOT EXISTS idx_projects_tenant_id ON projects(tenant_id);
                CREATE INDEX IF NOT EXISTS idx_projects_workspace_id ON projects(workspace_id);
                CREATE INDEX IF NOT EXISTS idx_generation_tasks_tenant_id ON generation_tasks(tenant_id);
                CREATE INDEX IF NOT EXISTS idx_generation_tasks_workspace_id ON generation_tasks(workspace_id);
                CREATE INDEX IF NOT EXISTS idx_generation_task_events_tenant_id ON generation_task_events(tenant_id);
                CREATE INDEX IF NOT EXISTS idx_generation_task_events_workspace_id ON generation_task_events(workspace_id);
                CREATE INDEX IF NOT EXISTS idx_token_usage_tenant_id ON token_usage_events(tenant_id);
                CREATE INDEX IF NOT EXISTS idx_token_usage_workspace_id ON token_usage_events(workspace_id);
                CREATE INDEX IF NOT EXISTS idx_billing_cost_tenant_id ON billing_cost_entries(tenant_id);
                CREATE INDEX IF NOT EXISTS idx_billing_cost_workspace_id ON billing_cost_entries(workspace_id);
                """
            )
            connection.execute(
                "UPDATE users SET default_tenant_id = COALESCE(NULLIF(default_tenant_id, ''), ?), default_workspace_id = COALESCE(NULLIF(default_workspace_id, ''), ?) WHERE default_tenant_id IS NULL OR default_tenant_id = '' OR default_workspace_id IS NULL OR default_workspace_id = ''",
                (DEFAULT_TENANT_ID, DEFAULT_WORKSPACE_ID),
            )
            for table in [
                "audit_logs",
                "projects",
                "generation_tasks",
                "generation_task_events",
                "token_usage_events",
                "billing_cost_entries",
            ]:
                connection.execute(
                    f"UPDATE {table} SET tenant_id = COALESCE(NULLIF(tenant_id, ''), ?), workspace_id = COALESCE(NULLIF(workspace_id, ''), ?) WHERE tenant_id IS NULL OR tenant_id = '' OR workspace_id IS NULL OR workspace_id = ''",
                    (DEFAULT_TENANT_ID, DEFAULT_WORKSPACE_ID),
                )

    def seed_defaults(self):
        with self.connect() as connection:
            timestamp = now_iso()
            connection.execute(
                """
                INSERT INTO tenants (
                    tenant_id, name, display_name, status, billing_mode, billing_currency,
                    created_at, updated_at
                )
                VALUES (?, ?, ?, 'active', 'internal', 'CNY', ?, ?)
                ON CONFLICT(tenant_id) DO UPDATE SET
                    name = excluded.name,
                    display_name = excluded.display_name,
                    updated_at = excluded.updated_at
                """,
                (
                    DEFAULT_TENANT_ID,
                    DEFAULT_TENANT_NAME,
                    DEFAULT_TENANT_NAME,
                    timestamp,
                    timestamp,
                ),
            )
            connection.execute(
                """
                INSERT INTO workspaces (
                    workspace_id, tenant_id, name, display_name, description, status,
                    billing_mode, created_at, updated_at
                )
                VALUES (?, ?, ?, ?, '历史数据和未分配数据默认归属项目组', 'active', 'inherit', ?, ?)
                ON CONFLICT(workspace_id) DO UPDATE SET
                    tenant_id = excluded.tenant_id,
                    name = excluded.name,
                    display_name = excluded.display_name,
                    updated_at = excluded.updated_at
                """,
                (
                    DEFAULT_WORKSPACE_ID,
                    DEFAULT_TENANT_ID,
                    DEFAULT_WORKSPACE_NAME,
                    DEFAULT_WORKSPACE_NAME,
                    timestamp,
                    timestamp,
                ),
            )
            for permission in PERMISSIONS:
                connection.execute(
                    """
                    INSERT INTO permissions (code, name, resource, action, created_at)
                    VALUES (?, ?, ?, ?, ?)
                    ON CONFLICT(code) DO UPDATE SET
                        name = excluded.name,
                        resource = excluded.resource,
                        action = excluded.action
                    """,
                    (
                        permission["code"],
                        permission["name"],
                        permission["resource"],
                        permission["action"],
                        timestamp,
                    ),
                )

            for code, role in ROLE_DEFINITIONS.items():
                connection.execute(
                    """
                    INSERT INTO roles (code, name, description, is_system, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?)
                    ON CONFLICT(code) DO UPDATE SET
                        name = excluded.name,
                        description = excluded.description,
                        is_system = excluded.is_system,
                        updated_at = excluded.updated_at
                    """,
                    (
                        code,
                        role["name"],
                        role["description"],
                        1 if role.get("system") else 0,
                        timestamp,
                        timestamp,
                    ),
                )
                role_id = connection.execute(
                    "SELECT id FROM roles WHERE code = ?",
                    (code,),
                ).fetchone()["id"]
                connection.execute("DELETE FROM role_permissions WHERE role_id = ?", (role_id,))
                for permission_code in role["permissions"]:
                    permission_row = connection.execute(
                        "SELECT id FROM permissions WHERE code = ?",
                        (permission_code,),
                    ).fetchone()
                    if permission_row:
                        connection.execute(
                            "INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)",
                            (role_id, permission_row["id"]),
                        )

            user_count = connection.execute("SELECT COUNT(*) AS count FROM users").fetchone()["count"]
            if user_count == 0:
                connection.execute(
                    """
                    INSERT INTO users (
                        username, display_name, password_hash, status, is_super_admin, created_at, updated_at
                    )
                    VALUES (?, ?, ?, 'active', 1, ?, ?)
                    """,
                    (
                        ADMIN_BOOTSTRAP_USERNAME,
                        ADMIN_BOOTSTRAP_DISPLAY_NAME,
                        hash_password(ADMIN_BOOTSTRAP_PASSWORD),
                        timestamp,
                        timestamp,
                    ),
                )
                user_id = connection.execute(
                    "SELECT id FROM users WHERE username = ?",
                    (ADMIN_BOOTSTRAP_USERNAME,),
                ).fetchone()["id"]
                role_id = connection.execute(
                    "SELECT id FROM roles WHERE code = 'super_admin'",
                ).fetchone()["id"]
                connection.execute(
                    "INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)",
                    (user_id, role_id),
                )
            connection.execute(
                """
                UPDATE users
                SET default_tenant_id = COALESCE(NULLIF(default_tenant_id, ''), ?),
                    default_workspace_id = COALESCE(NULLIF(default_workspace_id, ''), ?),
                    updated_at = updated_at
                """,
                (DEFAULT_TENANT_ID, DEFAULT_WORKSPACE_ID),
            )
            users = connection.execute("SELECT id, username, is_super_admin FROM users").fetchall()
            for user in users:
                role_in_tenant = "owner" if user["is_super_admin"] else "member"
                role_in_workspace = "owner" if user["is_super_admin"] else "operator"
                connection.execute(
                    """
                    INSERT INTO tenant_members (
                        tenant_id, user_id, role_in_tenant, status, joined_at, created_at, updated_at
                    )
                    VALUES (?, ?, ?, 'active', ?, ?, ?)
                    ON CONFLICT(tenant_id, user_id) DO NOTHING
                    """,
                    (DEFAULT_TENANT_ID, user["id"], role_in_tenant, timestamp, timestamp, timestamp),
                )
                connection.execute(
                    """
                    INSERT INTO workspace_members (
                        workspace_id, tenant_id, user_id, role_in_workspace, status, joined_at, created_at, updated_at
                    )
                    VALUES (?, ?, ?, ?, 'active', ?, ?, ?)
                    ON CONFLICT(workspace_id, user_id) DO NOTHING
                    """,
                    (DEFAULT_WORKSPACE_ID, DEFAULT_TENANT_ID, user["id"], role_in_workspace, timestamp, timestamp, timestamp),
                )
            try:
                from app.constants import LLM_ENDPOINT_ID
            except Exception:
                LLM_ENDPOINT_ID = ""
            if LLM_ENDPOINT_ID:
                connection.execute(
                    """
                    INSERT INTO billing_price_rules (
                        code, provider, model, endpoint_id, resource_type, phase,
                        input_price_per_1m_tokens, output_price_per_1m_tokens,
                        cached_input_price_per_1m_tokens, reasoning_price_per_1m_tokens,
                        currency, enabled, effective_from, created_at, updated_at
                    )
                    VALUES (?, 'volcengine', ?, ?, 'llm_token', '', 0, 0, 0, 0, 'CNY', 1, ?, ?, ?)
                    ON CONFLICT(code) DO NOTHING
                    """,
                    (
                        f"llm:{LLM_ENDPOINT_ID}",
                        LLM_ENDPOINT_ID,
                        LLM_ENDPOINT_ID,
                        timestamp,
                        timestamp,
                        timestamp,
                    ),
                )

    def get_user_by_username(self, username: str) -> Optional[Dict[str, Any]]:
        with self.connect() as connection:
            row = connection.execute(
                "SELECT * FROM users WHERE username = ?",
                (username,),
            ).fetchone()
            return row_to_dict(row) if row else None

    def get_user(self, user_id: int) -> Optional[Dict[str, Any]]:
        with self.connect() as connection:
            row = connection.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
            return row_to_dict(row) if row else None

    def touch_last_login(self, user_id: int):
        with self.connect() as connection:
            connection.execute(
                "UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?",
                (now_iso(), now_iso(), user_id),
            )

    def list_users(self, keyword: str = "", status: str = "") -> List[Dict[str, Any]]:
        sql = "SELECT * FROM users WHERE 1 = 1"
        params: List[Any] = []
        if keyword:
            sql += " AND (username LIKE ? OR display_name LIKE ? OR email LIKE ?)"
            like = f"%{keyword}%"
            params.extend([like, like, like])
        if status:
            sql += " AND status = ?"
            params.append(status)
        sql += " ORDER BY id DESC"
        with self.connect() as connection:
            rows = connection.execute(sql, params).fetchall()
            return [self.enrich_user(row_to_dict(row), connection) for row in rows]

    def create_user(
        self,
        username: str,
        display_name: str,
        password: str,
        email: str = "",
        phone: str = "",
        role_ids: Optional[List[int]] = None,
        default_tenant_id: str = DEFAULT_TENANT_ID,
        default_workspace_id: str = DEFAULT_WORKSPACE_ID,
    ) -> Dict[str, Any]:
        timestamp = now_iso()
        with self.connect() as connection:
            cursor = connection.execute(
                """
                INSERT INTO users (
                    username, display_name, email, phone, password_hash, status,
                    is_super_admin, default_tenant_id, default_workspace_id, created_at, updated_at
                )
                VALUES (?, ?, ?, ?, ?, 'active', 0, ?, ?, ?, ?)
                """,
                (
                    username,
                    display_name,
                    email,
                    phone,
                    hash_password(password),
                    default_tenant_id or DEFAULT_TENANT_ID,
                    default_workspace_id or DEFAULT_WORKSPACE_ID,
                    timestamp,
                    timestamp,
                ),
            )
            user_id = cursor.lastrowid
            self._replace_user_roles(connection, user_id, role_ids or [])
            self._ensure_user_org_membership(
                connection,
                user_id,
                default_tenant_id or DEFAULT_TENANT_ID,
                default_workspace_id or DEFAULT_WORKSPACE_ID,
                timestamp,
            )
            return self.enrich_user(row_to_dict(connection.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()), connection)

    def update_user(self, user_id: int, payload: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        allowed_fields = ["display_name", "email", "phone", "default_tenant_id", "default_workspace_id"]
        assignments = []
        params: List[Any] = []
        for field in allowed_fields:
            if field in payload:
                assignments.append(f"{field} = ?")
                params.append(payload.get(field) or "")
        if not assignments:
            return self.get_user_detail(user_id)
        assignments.append("updated_at = ?")
        params.append(now_iso())
        params.append(user_id)
        with self.connect() as connection:
            connection.execute(
                f"UPDATE users SET {', '.join(assignments)} WHERE id = ?",
                params,
            )
            if "default_workspace_id" in payload or "default_tenant_id" in payload:
                self._ensure_user_org_membership(
                    connection,
                    user_id,
                    payload.get("default_tenant_id") or DEFAULT_TENANT_ID,
                    payload.get("default_workspace_id") or DEFAULT_WORKSPACE_ID,
                    now_iso(),
                )
            row = connection.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
            return self.enrich_user(row_to_dict(row), connection) if row else None

    def _ensure_user_org_membership(
        self,
        connection: sqlite3.Connection,
        user_id: int,
        tenant_id: str,
        workspace_id: str,
        timestamp: str,
    ):
        workspace = connection.execute(
            "SELECT * FROM workspaces WHERE workspace_id = ?",
            (workspace_id,),
        ).fetchone()
        resolved_tenant_id = tenant_id or (workspace["tenant_id"] if workspace else DEFAULT_TENANT_ID)
        connection.execute(
            """
            INSERT INTO tenant_members (
                tenant_id, user_id, role_in_tenant, status, joined_at, created_at, updated_at
            )
            VALUES (?, ?, 'member', 'active', ?, ?, ?)
            ON CONFLICT(tenant_id, user_id) DO NOTHING
            """,
            (resolved_tenant_id, user_id, timestamp, timestamp, timestamp),
        )
        connection.execute(
            """
            INSERT INTO workspace_members (
                workspace_id, tenant_id, user_id, role_in_workspace, status, joined_at, created_at, updated_at
            )
            VALUES (?, ?, ?, 'operator', 'active', ?, ?, ?)
            ON CONFLICT(workspace_id, user_id) DO NOTHING
            """,
            (workspace_id or DEFAULT_WORKSPACE_ID, resolved_tenant_id, user_id, timestamp, timestamp, timestamp),
        )

    def set_user_status(self, user_id: int, status: str) -> Optional[Dict[str, Any]]:
        with self.connect() as connection:
            connection.execute(
                "UPDATE users SET status = ?, updated_at = ? WHERE id = ?",
                (status, now_iso(), user_id),
            )
            row = connection.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
            return self.enrich_user(row_to_dict(row), connection) if row else None

    def reset_password(self, user_id: int, password: str):
        with self.connect() as connection:
            connection.execute(
                "UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?",
                (hash_password(password), now_iso(), user_id),
            )

    def replace_user_roles(self, user_id: int, role_ids: List[int]) -> Optional[Dict[str, Any]]:
        with self.connect() as connection:
            self._replace_user_roles(connection, user_id, role_ids)
            row = connection.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
            return self.enrich_user(row_to_dict(row), connection) if row else None

    def _replace_user_roles(self, connection: sqlite3.Connection, user_id: int, role_ids: Iterable[int]):
        connection.execute("DELETE FROM user_roles WHERE user_id = ?", (user_id,))
        for role_id in role_ids:
            connection.execute(
                "INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)",
                (user_id, int(role_id)),
            )

    def list_roles(self) -> List[Dict[str, Any]]:
        with self.connect() as connection:
            rows = connection.execute("SELECT * FROM roles ORDER BY is_system DESC, id ASC").fetchall()
            return [self.enrich_role(row_to_dict(row), connection) for row in rows]

    def get_role(self, role_id: int) -> Optional[Dict[str, Any]]:
        with self.connect() as connection:
            row = connection.execute("SELECT * FROM roles WHERE id = ?", (role_id,)).fetchone()
            return self.enrich_role(row_to_dict(row), connection) if row else None

    def create_role(self, code: str, name: str, description: str, permission_codes: List[str]) -> Dict[str, Any]:
        timestamp = now_iso()
        with self.connect() as connection:
            cursor = connection.execute(
                """
                INSERT INTO roles (code, name, description, is_system, created_at, updated_at)
                VALUES (?, ?, ?, 0, ?, ?)
                """,
                (code, name, description, timestamp, timestamp),
            )
            role_id = cursor.lastrowid
            self._replace_role_permissions(connection, role_id, permission_codes)
            return self.enrich_role(row_to_dict(connection.execute("SELECT * FROM roles WHERE id = ?", (role_id,)).fetchone()), connection)

    def update_role(self, role_id: int, payload: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        with self.connect() as connection:
            role = connection.execute("SELECT * FROM roles WHERE id = ?", (role_id,)).fetchone()
            if not role:
                return None
            if role["is_system"]:
                connection.execute(
                    "UPDATE roles SET name = ?, description = ?, updated_at = ? WHERE id = ?",
                    (
                        payload.get("name") or role["name"],
                        payload.get("description") or "",
                        now_iso(),
                        role_id,
                    ),
                )
            else:
                connection.execute(
                    "UPDATE roles SET code = ?, name = ?, description = ?, updated_at = ? WHERE id = ?",
                    (
                        payload.get("code") or role["code"],
                        payload.get("name") or role["name"],
                        payload.get("description") or "",
                        now_iso(),
                        role_id,
                    ),
                )
            if "permission_codes" in payload:
                self._replace_role_permissions(connection, role_id, payload["permission_codes"] or [])
            row = connection.execute("SELECT * FROM roles WHERE id = ?", (role_id,)).fetchone()
            return self.enrich_role(row_to_dict(row), connection)

    def delete_role(self, role_id: int) -> bool:
        with self.connect() as connection:
            role = connection.execute("SELECT * FROM roles WHERE id = ?", (role_id,)).fetchone()
            if not role or role["is_system"]:
                return False
            connection.execute("DELETE FROM roles WHERE id = ?", (role_id,))
            return True

    def _replace_role_permissions(self, connection: sqlite3.Connection, role_id: int, permission_codes: Iterable[str]):
        connection.execute("DELETE FROM role_permissions WHERE role_id = ?", (role_id,))
        for permission_code in permission_codes:
            permission_row = connection.execute(
                "SELECT id FROM permissions WHERE code = ?",
                (permission_code,),
            ).fetchone()
            if permission_row:
                connection.execute(
                    "INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)",
                    (role_id, permission_row["id"]),
                )

    def list_permissions(self) -> List[Dict[str, Any]]:
        with self.connect() as connection:
            rows = connection.execute("SELECT * FROM permissions ORDER BY resource, action").fetchall()
            return [row_to_dict(row) for row in rows]

    def list_tenants(self) -> List[Dict[str, Any]]:
        with self.connect() as connection:
            rows = connection.execute(
                """
                SELECT
                    t.*,
                    COUNT(DISTINCT w.workspace_id) AS workspace_count,
                    COUNT(DISTINCT tm.user_id) AS user_count
                FROM tenants t
                LEFT JOIN workspaces w ON w.tenant_id = t.tenant_id
                LEFT JOIN tenant_members tm ON tm.tenant_id = t.tenant_id AND tm.status = 'active'
                GROUP BY t.id
                ORDER BY t.id ASC
                """
            ).fetchall()
            return [row_to_dict(row) for row in rows]

    def list_workspaces(self, tenant_id: str = "") -> List[Dict[str, Any]]:
        sql = """
            SELECT
                w.*,
                t.name AS tenant_name,
                t.display_name AS tenant_display_name,
                COUNT(DISTINCT wm.user_id) AS user_count,
                COUNT(DISTINCT p.project_id) AS project_count
            FROM workspaces w
            LEFT JOIN tenants t ON t.tenant_id = w.tenant_id
            LEFT JOIN workspace_members wm ON wm.workspace_id = w.workspace_id AND wm.status = 'active'
            LEFT JOIN projects p ON p.workspace_id = w.workspace_id
            WHERE 1 = 1
        """
        params: List[Any] = []
        if tenant_id:
            sql += " AND w.tenant_id = ?"
            params.append(tenant_id)
        sql += " GROUP BY w.id ORDER BY w.id ASC"
        with self.connect() as connection:
            rows = connection.execute(sql, params).fetchall()
            return [row_to_dict(row) for row in rows]

    def get_tenant(self, tenant_id: str) -> Optional[Dict[str, Any]]:
        with self.connect() as connection:
            row = connection.execute("SELECT * FROM tenants WHERE tenant_id = ?", (tenant_id,)).fetchone()
            return row_to_dict(row) if row else None

    def get_workspace(self, workspace_id: str) -> Optional[Dict[str, Any]]:
        with self.connect() as connection:
            row = connection.execute(
                """
                SELECT w.*, t.name AS tenant_name, t.display_name AS tenant_display_name
                FROM workspaces w
                LEFT JOIN tenants t ON t.tenant_id = w.tenant_id
                WHERE w.workspace_id = ?
                """,
                (workspace_id,),
            ).fetchone()
            return row_to_dict(row) if row else None

    def create_tenant(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        timestamp = now_iso()
        tenant_id = payload.get("tenant_id") or f"tenant_{uuid.uuid4().hex[:10]}"
        name = payload.get("name") or payload.get("display_name") or tenant_id
        with self.connect() as connection:
            connection.execute(
                """
                INSERT INTO tenants (
                    tenant_id, name, display_name, status, billing_mode, billing_currency,
                    contact_name, contact_email, contact_phone, created_at, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    tenant_id,
                    name,
                    payload.get("display_name") or name,
                    payload.get("status") or "active",
                    payload.get("billing_mode") or "internal",
                    payload.get("billing_currency") or "CNY",
                    payload.get("contact_name") or "",
                    payload.get("contact_email") or "",
                    payload.get("contact_phone") or "",
                    timestamp,
                    timestamp,
                ),
            )
            return self.get_tenant(tenant_id)

    def create_workspace(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        timestamp = now_iso()
        tenant_id = payload.get("tenant_id") or DEFAULT_TENANT_ID
        workspace_id = payload.get("workspace_id") or f"workspace_{uuid.uuid4().hex[:10]}"
        name = payload.get("name") or payload.get("display_name") or workspace_id
        with self.connect() as connection:
            connection.execute(
                """
                INSERT INTO workspaces (
                    workspace_id, tenant_id, name, display_name, description, status,
                    billing_mode, monthly_budget_limit, created_by_user_id, created_by_username,
                    created_at, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    workspace_id,
                    tenant_id,
                    name,
                    payload.get("display_name") or name,
                    payload.get("description") or "",
                    payload.get("status") or "active",
                    payload.get("billing_mode") or "inherit",
                    float(payload.get("monthly_budget_limit") or 0),
                    payload.get("created_by_user_id"),
                    payload.get("created_by_username") or "",
                    timestamp,
                    timestamp,
                ),
            )
            return self.get_workspace(workspace_id)

    def user_org_context(self, user: Optional[Dict[str, Any]]) -> Dict[str, str]:
        if not user:
            return {"tenant_id": DEFAULT_TENANT_ID, "workspace_id": DEFAULT_WORKSPACE_ID}
        return {
            "tenant_id": user.get("default_tenant_id") or DEFAULT_TENANT_ID,
            "workspace_id": user.get("default_workspace_id") or DEFAULT_WORKSPACE_ID,
        }

    def validate_user_workspace(
        self,
        user: Optional[Dict[str, Any]],
        tenant_id: str = "",
        workspace_id: str = "",
    ) -> Dict[str, str]:
        if not user:
            workspace = self.get_workspace(workspace_id or DEFAULT_WORKSPACE_ID) or {}
            return {
                "tenant_id": workspace.get("tenant_id") or tenant_id or DEFAULT_TENANT_ID,
                "workspace_id": workspace.get("workspace_id") or workspace_id or DEFAULT_WORKSPACE_ID,
            }
        if user.get("is_super_admin"):
            workspace = self.get_workspace(workspace_id or user.get("default_workspace_id") or DEFAULT_WORKSPACE_ID)
            return {
                "tenant_id": (workspace or {}).get("tenant_id") or tenant_id or user.get("default_tenant_id") or DEFAULT_TENANT_ID,
                "workspace_id": (workspace or {}).get("workspace_id") or workspace_id or user.get("default_workspace_id") or DEFAULT_WORKSPACE_ID,
            }
        workspaces = user.get("workspaces") or []
        allowed_workspace_ids = {item.get("workspace_id") for item in workspaces}
        requested_workspace_id = workspace_id or user.get("default_workspace_id") or DEFAULT_WORKSPACE_ID
        if requested_workspace_id not in allowed_workspace_ids:
            requested_workspace_id = user.get("default_workspace_id") or (workspaces[0].get("workspace_id") if workspaces else DEFAULT_WORKSPACE_ID)
        workspace = self.get_workspace(requested_workspace_id) or {}
        return {
            "tenant_id": workspace.get("tenant_id") or tenant_id or user.get("default_tenant_id") or DEFAULT_TENANT_ID,
            "workspace_id": requested_workspace_id,
        }

    def get_user_permissions(self, user_id: int) -> List[str]:
        user = self.get_user(user_id)
        if not user:
            return []
        if user.get("is_super_admin"):
            return [permission["code"] for permission in PERMISSIONS]
        with self.connect() as connection:
            return self._get_user_permissions(connection, user_id, bool(user.get("is_super_admin")))

    def _get_user_permissions(
        self,
        connection: sqlite3.Connection,
        user_id: int,
        is_super_admin: bool,
    ) -> List[str]:
        if is_super_admin:
            return [permission["code"] for permission in PERMISSIONS]
        rows = connection.execute(
            """
            SELECT DISTINCT p.code
            FROM permissions p
            JOIN role_permissions rp ON rp.permission_id = p.id
            JOIN user_roles ur ON ur.role_id = rp.role_id
            WHERE ur.user_id = ?
            ORDER BY p.code
            """,
            (user_id,),
        ).fetchall()
        return [row["code"] for row in rows]

    def enrich_user(self, user: Dict[str, Any], connection: sqlite3.Connection) -> Dict[str, Any]:
        roles = connection.execute(
            """
            SELECT r.*
            FROM roles r
            JOIN user_roles ur ON ur.role_id = r.id
            WHERE ur.user_id = ?
            ORDER BY r.id
            """,
            (user["id"],),
        ).fetchall()
        tenants = connection.execute(
            """
            SELECT t.*, tm.role_in_tenant, tm.status AS membership_status
            FROM tenants t
            JOIN tenant_members tm ON tm.tenant_id = t.tenant_id
            WHERE tm.user_id = ? AND tm.status = 'active'
            ORDER BY t.id
            """,
            (user["id"],),
        ).fetchall()
        workspaces = connection.execute(
            """
            SELECT w.*, t.name AS tenant_name, t.display_name AS tenant_display_name,
                   wm.role_in_workspace, wm.status AS membership_status
            FROM workspaces w
            JOIN workspace_members wm ON wm.workspace_id = w.workspace_id
            LEFT JOIN tenants t ON t.tenant_id = w.tenant_id
            WHERE wm.user_id = ? AND wm.status = 'active'
            ORDER BY w.id
            """,
            (user["id"],),
        ).fetchall()
        user = dict(user)
        user.pop("password_hash", None)
        user["is_super_admin"] = bool(user.get("is_super_admin"))
        user["roles"] = [row_to_dict(role) for role in roles]
        user["tenants"] = [row_to_dict(row) for row in tenants]
        user["workspaces"] = [row_to_dict(row) for row in workspaces]
        user["default_tenant_id"] = user.get("default_tenant_id") or DEFAULT_TENANT_ID
        user["default_workspace_id"] = user.get("default_workspace_id") or DEFAULT_WORKSPACE_ID
        user["default_tenant"] = next(
            (item for item in user["tenants"] if item.get("tenant_id") == user["default_tenant_id"]),
            self.get_tenant(user["default_tenant_id"]) or {},
        )
        user["default_workspace"] = next(
            (item for item in user["workspaces"] if item.get("workspace_id") == user["default_workspace_id"]),
            self.get_workspace(user["default_workspace_id"]) or {},
        )
        user["permissions"] = self._get_user_permissions(
            connection,
            int(user["id"]),
            bool(user["is_super_admin"]),
        )
        return user

    def enrich_role(self, role: Dict[str, Any], connection: sqlite3.Connection) -> Dict[str, Any]:
        permissions = connection.execute(
            """
            SELECT p.*
            FROM permissions p
            JOIN role_permissions rp ON rp.permission_id = p.id
            WHERE rp.role_id = ?
            ORDER BY p.resource, p.action
            """,
            (role["id"],),
        ).fetchall()
        role = dict(role)
        role["is_system"] = bool(role.get("is_system"))
        role["permissions"] = [row_to_dict(permission) for permission in permissions]
        role["permission_codes"] = [permission["code"] for permission in role["permissions"]]
        return role

    def get_user_detail(self, user_id: int) -> Optional[Dict[str, Any]]:
        with self.connect() as connection:
            row = connection.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
            return self.enrich_user(row_to_dict(row), connection) if row else None

    def create_audit_log(
        self,
        action: str,
        resource_type: str,
        resource_id: str = "",
        actor: Optional[Dict[str, Any]] = None,
        before: Optional[Any] = None,
        after: Optional[Any] = None,
        ip: str = "",
        user_agent: str = "",
        tenant_id: str = "",
        workspace_id: str = "",
    ):
        org_context = self.user_org_context(actor)
        tenant_id = tenant_id or org_context["tenant_id"]
        workspace_id = workspace_id or org_context["workspace_id"]
        with self.connect() as connection:
            connection.execute(
                """
                INSERT INTO audit_logs (
                    actor_user_id, actor_username, tenant_id, workspace_id, action, resource_type, resource_id,
                    before_json, after_json, ip, user_agent, created_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    actor.get("id") if actor else None,
                    actor.get("username") if actor else "",
                    tenant_id,
                    workspace_id,
                    action,
                    resource_type,
                    str(resource_id or ""),
                    json.dumps(before, ensure_ascii=False) if before is not None else None,
                    json.dumps(after, ensure_ascii=False) if after is not None else None,
                    ip,
                    user_agent,
                    now_iso(),
                ),
            )

    def ensure_project_record(
        self,
        project_id: str,
        project_dir: str = "",
        manifest_path: str = "",
        created_at: str = "",
        updated_at: str = "",
        owner: Optional[Dict[str, Any]] = None,
        created_by: Optional[Dict[str, Any]] = None,
        tenant_id: str = "",
        workspace_id: str = "",
    ) -> Dict[str, Any]:
        timestamp = now_iso()
        created_value = created_at or timestamp
        updated_value = updated_at or created_value
        owner = owner or {}
        created_by = created_by or owner or {}
        owner_user_id = owner.get("id")
        owner_username = owner.get("username") or ""
        owner_display_name = owner.get("display_name") or owner_username
        created_by_user_id = created_by.get("id")
        created_by_username = created_by.get("username") or ""
        org_context = self.validate_user_workspace(created_by or owner, tenant_id, workspace_id)
        tenant_id = org_context["tenant_id"]
        workspace_id = org_context["workspace_id"]
        with self.connect() as connection:
            connection.execute(
                """
                INSERT INTO projects (
                    project_id, tenant_id, workspace_id, name, owner_user_id, owner_username, owner_display_name,
                    created_by_user_id, created_by_username, status, visibility,
                    project_dir, manifest_path, created_at, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 'private', ?, ?, ?, ?)
                ON CONFLICT(project_id) DO UPDATE SET
                    tenant_id = COALESCE(NULLIF(projects.tenant_id, ''), excluded.tenant_id),
                    workspace_id = COALESCE(NULLIF(projects.workspace_id, ''), excluded.workspace_id),
                    project_dir = COALESCE(NULLIF(excluded.project_dir, ''), projects.project_dir),
                    manifest_path = COALESCE(NULLIF(excluded.manifest_path, ''), projects.manifest_path),
                    updated_at = CASE
                        WHEN excluded.updated_at > projects.updated_at THEN excluded.updated_at
                        ELSE projects.updated_at
                    END
                """,
                (
                    project_id,
                    tenant_id,
                    workspace_id,
                    project_id,
                    owner_user_id,
                    owner_username,
                    owner_display_name,
                    created_by_user_id,
                    created_by_username,
                    project_dir,
                    manifest_path,
                    created_value,
                    updated_value,
                ),
            )
            row = connection.execute(
                "SELECT * FROM projects WHERE project_id = ?",
                (project_id,),
            ).fetchone()
            return row_to_dict(row)

    def get_project_record(self, project_id: str) -> Optional[Dict[str, Any]]:
        with self.connect() as connection:
            row = connection.execute(
                """
                SELECT p.*,
                       t.name AS tenant_name,
                       t.display_name AS tenant_display_name,
                       w.name AS workspace_name,
                       w.display_name AS workspace_display_name
                FROM projects p
                LEFT JOIN tenants t ON t.tenant_id = p.tenant_id
                LEFT JOIN workspaces w ON w.workspace_id = p.workspace_id
                WHERE p.project_id = ?
                """,
                (project_id,),
            ).fetchone()
            return row_to_dict(row) if row else None

    def list_project_records(self) -> Dict[str, Dict[str, Any]]:
        with self.connect() as connection:
            rows = connection.execute(
                """
                SELECT p.*,
                       t.name AS tenant_name,
                       t.display_name AS tenant_display_name,
                       w.name AS workspace_name,
                       w.display_name AS workspace_display_name
                FROM projects p
                LEFT JOIN tenants t ON t.tenant_id = p.tenant_id
                LEFT JOIN workspaces w ON w.workspace_id = p.workspace_id
                """
            ).fetchall()
            return {row["project_id"]: row_to_dict(row) for row in rows}

    def assign_project_owner(
        self,
        project_id: str,
        owner_user_id: Optional[int],
    ) -> Optional[Dict[str, Any]]:
        timestamp = now_iso()
        with self.connect() as connection:
            project = connection.execute(
                "SELECT * FROM projects WHERE project_id = ?",
                (project_id,),
            ).fetchone()
            if not project:
                return None
            owner_username = ""
            owner_display_name = ""
            if owner_user_id:
                user = connection.execute(
                    "SELECT id, username, display_name FROM users WHERE id = ?",
                    (owner_user_id,),
                ).fetchone()
                if not user:
                    return None
                owner_username = user["username"]
                owner_display_name = user["display_name"]
            connection.execute(
                """
                UPDATE projects
                SET owner_user_id = ?,
                    owner_username = ?,
                    owner_display_name = ?,
                    updated_at = ?
                WHERE project_id = ?
                """,
                (
                    owner_user_id,
                    owner_username,
                    owner_display_name,
                    timestamp,
                    project_id,
                ),
            )
            row = connection.execute(
                """
                SELECT p.*,
                       t.name AS tenant_name,
                       t.display_name AS tenant_display_name,
                       w.name AS workspace_name,
                       w.display_name AS workspace_display_name
                FROM projects p
                LEFT JOIN tenants t ON t.tenant_id = p.tenant_id
                LEFT JOIN workspaces w ON w.workspace_id = p.workspace_id
                WHERE p.project_id = ?
                """,
                (project_id,),
            ).fetchone()
            return row_to_dict(row)

    def delete_project_record(self, project_id: str):
        with self.connect() as connection:
            connection.execute("DELETE FROM projects WHERE project_id = ?", (project_id,))

    def find_price_rule(
        self,
        provider: str,
        endpoint_id: str = "",
        model: str = "",
        phase: str = "",
        tenant_id: str = "",
        workspace_id: str = "",
    ) -> Optional[Dict[str, Any]]:
        clauses = ["provider = ?", "resource_type = 'llm_token'", "enabled = 1"]
        params: List[Any] = [provider]
        if tenant_id:
            clauses.append("(tenant_id = ? OR tenant_id IS NULL OR tenant_id = '')")
            params.append(tenant_id)
        if workspace_id:
            clauses.append("(workspace_id = ? OR workspace_id IS NULL OR workspace_id = '')")
            params.append(workspace_id)
        if endpoint_id:
            clauses.append("(endpoint_id = ? OR endpoint_id = '')")
            params.append(endpoint_id)
        if model:
            clauses.append("(model = ? OR model = '')")
            params.append(model)
        if phase:
            clauses.append("(phase = ? OR phase = '')")
            params.append(phase)
        sql = f"""
            SELECT *
            FROM billing_price_rules
            WHERE {' AND '.join(clauses)}
            ORDER BY
                CASE WHEN endpoint_id = ? THEN 0 ELSE 1 END,
                CASE WHEN model = ? THEN 0 ELSE 1 END,
                CASE WHEN phase = ? THEN 0 ELSE 1 END,
                CASE WHEN workspace_id = ? THEN 0 ELSE 1 END,
                CASE WHEN tenant_id = ? THEN 0 ELSE 1 END,
                id DESC
            LIMIT 1
        """
        params.extend([endpoint_id, model, phase, workspace_id, tenant_id])
        with self.connect() as connection:
            row = connection.execute(sql, params).fetchone()
            return row_to_dict(row) if row else None

    def list_price_rules(self) -> List[Dict[str, Any]]:
        with self.connect() as connection:
            rows = connection.execute(
                "SELECT * FROM billing_price_rules ORDER BY enabled DESC, id DESC",
            ).fetchall()
            return [row_to_dict(row) for row in rows]

    def create_price_rule(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        timestamp = now_iso()
        with self.connect() as connection:
            cursor = connection.execute(
                """
                INSERT INTO billing_price_rules (
                    code, tenant_id, workspace_id, provider, model, endpoint_id, resource_type, phase,
                    input_price_per_1m_tokens, output_price_per_1m_tokens,
                    cached_input_price_per_1m_tokens, reasoning_price_per_1m_tokens,
                    currency, enabled, effective_from, effective_to, created_at, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    payload.get("code") or f"rule:{timestamp}",
                    payload.get("tenant_id") or "",
                    payload.get("workspace_id") or "",
                    payload.get("provider") or "volcengine",
                    payload.get("model") or "",
                    payload.get("endpoint_id") or "",
                    payload.get("resource_type") or "llm_token",
                    payload.get("phase") or "",
                    float(payload.get("input_price_per_1m_tokens") or 0),
                    float(payload.get("output_price_per_1m_tokens") or 0),
                    float(payload.get("cached_input_price_per_1m_tokens") or 0),
                    float(payload.get("reasoning_price_per_1m_tokens") or 0),
                    payload.get("currency") or "CNY",
                    1 if payload.get("enabled", True) else 0,
                    payload.get("effective_from") or timestamp,
                    payload.get("effective_to") or "",
                    timestamp,
                    timestamp,
                ),
            )
            row = connection.execute(
                "SELECT * FROM billing_price_rules WHERE id = ?",
                (cursor.lastrowid,),
            ).fetchone()
            return row_to_dict(row)

    def update_price_rule(self, rule_id: int, payload: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        allowed_fields = [
            "code",
            "provider",
            "model",
            "endpoint_id",
            "resource_type",
            "phase",
            "tenant_id",
            "workspace_id",
            "input_price_per_1m_tokens",
            "output_price_per_1m_tokens",
            "cached_input_price_per_1m_tokens",
            "reasoning_price_per_1m_tokens",
            "currency",
            "enabled",
            "effective_from",
            "effective_to",
        ]
        assignments = []
        params: List[Any] = []
        for field in allowed_fields:
            if field in payload:
                assignments.append(f"{field} = ?")
                value = payload[field]
                if field == "enabled":
                    value = 1 if value else 0
                elif field.endswith("_price_per_1m_tokens"):
                    value = float(value or 0)
                params.append(value)
        if not assignments:
            with self.connect() as connection:
                row = connection.execute(
                    "SELECT * FROM billing_price_rules WHERE id = ?",
                    (rule_id,),
                ).fetchone()
                return row_to_dict(row) if row else None
        assignments.append("updated_at = ?")
        params.append(now_iso())
        params.append(rule_id)
        with self.connect() as connection:
            connection.execute(
                f"UPDATE billing_price_rules SET {', '.join(assignments)} WHERE id = ?",
                params,
            )
            row = connection.execute(
                "SELECT * FROM billing_price_rules WHERE id = ?",
                (rule_id,),
            ).fetchone()
            return row_to_dict(row) if row else None

    def record_token_usage(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        timestamp = now_iso()
        event_id = payload.get("event_id") or f"usage:{timestamp}:{payload.get('request_id') or ''}"
        prompt_tokens = int(payload.get("prompt_tokens") or 0)
        completion_tokens = int(payload.get("completion_tokens") or 0)
        total_tokens = int(payload.get("total_tokens") or prompt_tokens + completion_tokens)
        cached_tokens = int(payload.get("cached_tokens") or 0)
        reasoning_tokens = int(payload.get("reasoning_tokens") or 0)
        provider = payload.get("provider") or "volcengine"
        endpoint_id = payload.get("endpoint_id") or ""
        model = payload.get("model") or endpoint_id
        phase = payload.get("phase") or ""
        tenant_id = payload.get("tenant_id") or ""
        workspace_id = payload.get("workspace_id") or ""
        if (not tenant_id or not workspace_id) and payload.get("task_id"):
            task = self.get_generation_task(payload.get("task_id"))
            tenant_id = tenant_id or (task or {}).get("tenant_id") or ""
            workspace_id = workspace_id or (task or {}).get("workspace_id") or ""
        if (not tenant_id or not workspace_id) and payload.get("project_id"):
            project = self.get_project_record(payload.get("project_id"))
            tenant_id = tenant_id or (project or {}).get("tenant_id") or DEFAULT_TENANT_ID
            workspace_id = workspace_id or (project or {}).get("workspace_id") or DEFAULT_WORKSPACE_ID
        tenant_id = tenant_id or DEFAULT_TENANT_ID
        workspace_id = workspace_id or DEFAULT_WORKSPACE_ID
        rule = self.find_price_rule(
            provider,
            endpoint_id=endpoint_id,
            model=model,
            phase=phase,
            tenant_id=tenant_id,
            workspace_id=workspace_id,
        ) or {}
        input_unit_price = float(rule.get("input_price_per_1m_tokens") or 0)
        output_unit_price = float(rule.get("output_price_per_1m_tokens") or 0)
        cached_input_unit_price = float(rule.get("cached_input_price_per_1m_tokens") or 0)
        reasoning_unit_price = float(rule.get("reasoning_price_per_1m_tokens") or 0)
        billed_prompt_tokens = max(prompt_tokens - cached_tokens, 0)
        input_cost = billed_prompt_tokens / 1_000_000 * input_unit_price
        output_cost = completion_tokens / 1_000_000 * output_unit_price
        cached_input_cost = cached_tokens / 1_000_000 * cached_input_unit_price
        reasoning_cost = reasoning_tokens / 1_000_000 * reasoning_unit_price
        total_cost = input_cost + output_cost + cached_input_cost + reasoning_cost
        currency = rule.get("currency") or "CNY"
        with self.connect() as connection:
            connection.execute(
                """
                INSERT OR IGNORE INTO token_usage_events (
                    event_id, tenant_id, workspace_id, user_id, username, project_id, task_id, phase,
                    provider, model, endpoint_id, request_id,
                    prompt_tokens, completion_tokens, total_tokens, cached_tokens, reasoning_tokens,
                    status, error_code, error_message, raw_usage_json, raw_response_meta_json,
                    started_at, finished_at, created_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    event_id,
                    tenant_id,
                    workspace_id,
                    payload.get("user_id"),
                    payload.get("username") or "",
                    payload.get("project_id") or "",
                    payload.get("task_id") or "",
                    phase,
                    provider,
                    model,
                    endpoint_id,
                    payload.get("request_id") or "",
                    prompt_tokens,
                    completion_tokens,
                    total_tokens,
                    cached_tokens,
                    reasoning_tokens,
                    payload.get("status") or "succeeded",
                    payload.get("error_code") or "",
                    payload.get("error_message") or "",
                    json.dumps(payload.get("raw_usage") or {}, ensure_ascii=False),
                    json.dumps(payload.get("raw_response_meta") or {}, ensure_ascii=False),
                    payload.get("started_at") or timestamp,
                    payload.get("finished_at") or timestamp,
                    timestamp,
                ),
            )
            usage_row = connection.execute(
                "SELECT * FROM token_usage_events WHERE event_id = ?",
                (event_id,),
            ).fetchone()
            cost_entry_id = f"cost:{event_id}"
            connection.execute(
                """
                INSERT OR IGNORE INTO billing_cost_entries (
                    cost_entry_id, usage_event_id, tenant_id, workspace_id, user_id, username, project_id, task_id, phase,
                    provider, model, prompt_tokens, completion_tokens, total_tokens, cached_tokens, reasoning_tokens,
                    input_unit_price, output_unit_price, cached_input_unit_price, reasoning_unit_price,
                    input_cost, output_cost, cached_input_cost, reasoning_cost, total_cost,
                    currency, pricing_rule_id, pricing_snapshot_json, status, created_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', ?)
                """,
                (
                    cost_entry_id,
                    event_id,
                    tenant_id,
                    workspace_id,
                    payload.get("user_id"),
                    payload.get("username") or "",
                    payload.get("project_id") or "",
                    payload.get("task_id") or "",
                    phase,
                    provider,
                    model,
                    prompt_tokens,
                    completion_tokens,
                    total_tokens,
                    cached_tokens,
                    reasoning_tokens,
                    input_unit_price,
                    output_unit_price,
                    cached_input_unit_price,
                    reasoning_unit_price,
                    input_cost,
                    output_cost,
                    cached_input_cost,
                    reasoning_cost,
                    total_cost,
                    currency,
                    rule.get("id"),
                    json.dumps(rule, ensure_ascii=False) if rule else None,
                    timestamp,
                ),
            )
            usage = row_to_dict(usage_row)
            cost_row = connection.execute(
                "SELECT * FROM billing_cost_entries WHERE usage_event_id = ?",
                (event_id,),
            ).fetchone()
            usage["cost_entry"] = row_to_dict(cost_row) if cost_row else None
            return usage

    def billing_summary(self, scope: Optional[AdminDataScope] = None) -> Dict[str, Any]:
        scope_condition, scope_params = scoped_sql_condition(
            scope,
            alias="c",
            user_column="c.user_id",
        )
        where_sql = f"WHERE {scope_condition}" if scope_condition else ""
        with self.connect() as connection:
            total = row_to_dict(connection.execute(
                f"""
                SELECT
                    COALESCE(SUM(prompt_tokens), 0) AS prompt_tokens,
                    COALESCE(SUM(completion_tokens), 0) AS completion_tokens,
                    COALESCE(SUM(total_tokens), 0) AS total_tokens,
                    COALESCE(SUM(cached_tokens), 0) AS cached_tokens,
                    COALESCE(SUM(reasoning_tokens), 0) AS reasoning_tokens,
                    COALESCE(SUM(input_cost), 0) AS input_cost,
                    COALESCE(SUM(output_cost), 0) AS output_cost,
                    COALESCE(SUM(cached_input_cost), 0) AS cached_input_cost,
                    COALESCE(SUM(reasoning_cost), 0) AS reasoning_cost,
                    COALESCE(SUM(total_cost), 0) AS total_cost
                FROM billing_cost_entries c
                {where_sql}
                """,
                scope_params,
            ).fetchone())
            count_where = f"WHERE {scope_condition} AND " if scope_condition else "WHERE "
            project_count = connection.execute(
                f"SELECT COUNT(DISTINCT project_id) AS count FROM billing_cost_entries c {count_where}project_id != ''",
                scope_params,
            ).fetchone()["count"]
            task_count = connection.execute(
                f"SELECT COUNT(DISTINCT task_id) AS count FROM billing_cost_entries c {count_where}task_id != ''",
                scope_params,
            ).fetchone()["count"]
            user_count = connection.execute(
                f"SELECT COUNT(DISTINCT user_id) AS count FROM billing_cost_entries c {count_where}user_id IS NOT NULL",
                scope_params,
            ).fetchone()["count"]
            total.update({
                "project_count": project_count,
                "task_count": task_count,
                "user_count": user_count,
                "currency": "CNY",
            })
            return total

    def billing_project_summaries(
        self,
        limit: int = 100,
        scope: Optional[AdminDataScope] = None,
    ) -> List[Dict[str, Any]]:
        scope_condition, scope_params = scoped_sql_condition(
            scope,
            alias="c",
            owner_columns=("p.owner_user_id", "p.created_by_user_id"),
            user_column="c.user_id",
        )
        scope_sql = f" AND {scope_condition}" if scope_condition else ""
        with self.connect() as connection:
            rows = connection.execute(
                f"""
                SELECT
                    c.tenant_id,
                    c.workspace_id,
                    t.name AS tenant_name,
                    t.display_name AS tenant_display_name,
                    w.name AS workspace_name,
                    w.display_name AS workspace_display_name,
                    c.project_id,
                    p.owner_user_id,
                    p.owner_username,
                    p.owner_display_name,
                    COUNT(DISTINCT c.task_id) AS task_count,
                    SUM(c.prompt_tokens) AS prompt_tokens,
                    SUM(c.completion_tokens) AS completion_tokens,
                    SUM(c.total_tokens) AS total_tokens,
                    SUM(c.cached_tokens) AS cached_tokens,
                    SUM(c.reasoning_tokens) AS reasoning_tokens,
                    SUM(c.input_cost) AS input_cost,
                    SUM(c.output_cost) AS output_cost,
                    SUM(c.cached_input_cost) AS cached_input_cost,
                    SUM(c.reasoning_cost) AS reasoning_cost,
                    SUM(c.total_cost) AS total_cost,
                    MAX(c.created_at) AS updated_at
                FROM billing_cost_entries c
                LEFT JOIN projects p ON p.project_id = c.project_id
                LEFT JOIN tenants t ON t.tenant_id = c.tenant_id
                LEFT JOIN workspaces w ON w.workspace_id = c.workspace_id
                WHERE c.project_id != ''
                {scope_sql}
                GROUP BY c.tenant_id, c.workspace_id, c.project_id
                ORDER BY total_cost DESC, total_tokens DESC
                LIMIT ?
                """,
                [*scope_params, limit],
            ).fetchall()
            return [row_to_dict(row) for row in rows]

    def billing_task_summaries(
        self,
        limit: int = 100,
        project_id: str = "",
        scope: Optional[AdminDataScope] = None,
    ) -> List[Dict[str, Any]]:
        scope_condition, scope_params = scoped_sql_condition(
            scope,
            alias="c",
            owner_columns=("t.creator_user_id", "p.owner_user_id", "p.created_by_user_id"),
            user_column="c.user_id",
        )
        sql = """
            SELECT
                c.tenant_id,
                c.workspace_id,
                ten.name AS tenant_name,
                ten.display_name AS tenant_display_name,
                w.name AS workspace_name,
                w.display_name AS workspace_display_name,
                c.task_id,
                c.project_id,
                c.user_id,
                c.username,
                c.phase,
                t.status,
                COUNT(c.id) AS event_count,
                SUM(c.prompt_tokens) AS prompt_tokens,
                SUM(c.completion_tokens) AS completion_tokens,
                SUM(c.total_tokens) AS total_tokens,
                SUM(c.cached_tokens) AS cached_tokens,
                SUM(c.reasoning_tokens) AS reasoning_tokens,
                SUM(c.input_cost) AS input_cost,
                SUM(c.output_cost) AS output_cost,
                SUM(c.cached_input_cost) AS cached_input_cost,
                SUM(c.reasoning_cost) AS reasoning_cost,
                SUM(c.total_cost) AS total_cost,
                MAX(c.created_at) AS updated_at
            FROM billing_cost_entries c
            LEFT JOIN generation_tasks t ON t.task_id = c.task_id
            LEFT JOIN projects p ON p.project_id = c.project_id
            LEFT JOIN tenants ten ON ten.tenant_id = c.tenant_id
            LEFT JOIN workspaces w ON w.workspace_id = c.workspace_id
            WHERE c.task_id != ''
        """
        params: List[Any] = []
        if scope_condition:
            sql += f" AND {scope_condition}"
            params.extend(scope_params)
        if project_id:
            sql += " AND c.project_id = ?"
            params.append(project_id)
        sql += """
            GROUP BY c.tenant_id, c.workspace_id, c.task_id, c.project_id, c.user_id, c.username, c.phase, t.status
            ORDER BY total_cost DESC, total_tokens DESC
            LIMIT ?
        """
        params.append(limit)
        with self.connect() as connection:
            rows = connection.execute(sql, params).fetchall()
            return [row_to_dict(row) for row in rows]

    def list_token_usage_events(
        self,
        limit: int = 100,
        project_id: str = "",
        task_id: str = "",
        tenant_id: str = "",
        workspace_id: str = "",
        scope: Optional[AdminDataScope] = None,
    ) -> List[Dict[str, Any]]:
        scope_condition, scope_params = scoped_sql_condition(
            scope,
            alias="e",
            owner_columns=("p.owner_user_id", "p.created_by_user_id"),
            user_column="e.user_id",
        )
        sql = """
            SELECT e.*
            FROM token_usage_events e
            LEFT JOIN projects p ON p.project_id = e.project_id
            WHERE 1 = 1
        """
        params: List[Any] = []
        if scope_condition:
            sql += f" AND {scope_condition}"
            params.extend(scope_params)
        if tenant_id:
            sql += " AND e.tenant_id = ?"
            params.append(tenant_id)
        if workspace_id:
            sql += " AND e.workspace_id = ?"
            params.append(workspace_id)
        if project_id:
            sql += " AND e.project_id = ?"
            params.append(project_id)
        if task_id:
            sql += " AND e.task_id = ?"
            params.append(task_id)
        sql += " ORDER BY e.id DESC LIMIT ?"
        params.append(limit)
        with self.connect() as connection:
            rows = connection.execute(sql, params).fetchall()
            return [row_to_dict(row) for row in rows]

    def list_audit_logs(
        self,
        limit: int = 100,
        action: str = "",
        actor_username: str = "",
        resource_type: str = "",
        tenant_id: str = "",
        workspace_id: str = "",
    ) -> List[Dict[str, Any]]:
        sql = "SELECT * FROM audit_logs WHERE 1 = 1"
        params: List[Any] = []
        if tenant_id:
            sql += " AND tenant_id = ?"
            params.append(tenant_id)
        if workspace_id:
            sql += " AND workspace_id = ?"
            params.append(workspace_id)
        if action:
            sql += " AND action LIKE ?"
            params.append(f"%{action}%")
        if actor_username:
            sql += " AND actor_username LIKE ?"
            params.append(f"%{actor_username}%")
        if resource_type:
            sql += " AND resource_type = ?"
            params.append(resource_type)
        sql += " ORDER BY id DESC LIMIT ?"
        params.append(limit)
        with self.connect() as connection:
            rows = connection.execute(sql, params).fetchall()
            return [row_to_dict(row) for row in rows]

    def upsert_generation_task(
        self,
        task_id: str,
        project_id: str,
        task_type: str,
        status: str,
        phase: str,
        progress: int = 0,
        creator_user_id: Optional[int] = None,
        creator_username: str = "",
        input_summary: str = "",
        error_code: str = "",
        error_type: str = "",
        error_message: str = "",
        error_detail: str = "",
        provider: str = "",
        retryable: bool = False,
        started_at: str = "",
        finished_at: str = "",
        metadata: Optional[Dict[str, Any]] = None,
        tenant_id: str = "",
        workspace_id: str = "",
    ) -> Dict[str, Any]:
        timestamp = now_iso()
        project = self.get_project_record(project_id) if project_id else None
        tenant_id = tenant_id or (project or {}).get("tenant_id") or DEFAULT_TENANT_ID
        workspace_id = workspace_id or (project or {}).get("workspace_id") or DEFAULT_WORKSPACE_ID
        with self.connect() as connection:
            connection.execute(
                """
                INSERT INTO generation_tasks (
                    task_id, tenant_id, workspace_id, project_id, creator_user_id, creator_username, task_type,
                    status, phase, progress, input_summary, error_code, error_type,
                    error_message, error_detail, provider, retryable, started_at,
                    finished_at, created_at, updated_at, metadata_json
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(task_id) DO UPDATE SET
                    tenant_id = COALESCE(NULLIF(generation_tasks.tenant_id, ''), excluded.tenant_id),
                    workspace_id = COALESCE(NULLIF(generation_tasks.workspace_id, ''), excluded.workspace_id),
                    project_id = excluded.project_id,
                    creator_user_id = COALESCE(excluded.creator_user_id, generation_tasks.creator_user_id),
                    creator_username = COALESCE(NULLIF(excluded.creator_username, ''), generation_tasks.creator_username),
                    task_type = excluded.task_type,
                    status = excluded.status,
                    phase = excluded.phase,
                    progress = excluded.progress,
                    input_summary = COALESCE(NULLIF(excluded.input_summary, ''), generation_tasks.input_summary),
                    error_code = excluded.error_code,
                    error_type = excluded.error_type,
                    error_message = excluded.error_message,
                    error_detail = excluded.error_detail,
                    provider = excluded.provider,
                    retryable = excluded.retryable,
                    started_at = COALESCE(NULLIF(excluded.started_at, ''), generation_tasks.started_at),
                    finished_at = excluded.finished_at,
                    updated_at = excluded.updated_at,
                    metadata_json = COALESCE(excluded.metadata_json, generation_tasks.metadata_json)
                """,
                (
                    task_id,
                    tenant_id,
                    workspace_id,
                    project_id,
                    creator_user_id,
                    creator_username,
                    task_type,
                    status,
                    phase,
                    int(progress or 0),
                    input_summary,
                    error_code,
                    error_type,
                    error_message,
                    error_detail,
                    provider,
                    1 if retryable else 0,
                    started_at,
                    finished_at,
                    timestamp,
                    timestamp,
                    json.dumps(metadata, ensure_ascii=False) if metadata is not None else None,
                ),
            )
            row = connection.execute(
                "SELECT * FROM generation_tasks WHERE task_id = ?",
                (task_id,),
            ).fetchone()
            return self._normalize_generation_task(row_to_dict(row), connection)

    def update_generation_task(self, task_id: str, payload: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        allowed_fields = [
            "project_id",
            "tenant_id",
            "workspace_id",
            "creator_user_id",
            "creator_username",
            "task_type",
            "status",
            "phase",
            "progress",
            "input_summary",
            "error_code",
            "error_type",
            "error_message",
            "error_detail",
            "provider",
            "retryable",
            "started_at",
            "finished_at",
            "metadata_json",
        ]
        assignments = []
        params: List[Any] = []
        for field in allowed_fields:
            if field in payload:
                assignments.append(f"{field} = ?")
                value = payload[field]
                if field == "retryable":
                    value = 1 if value else 0
                if field == "metadata_json" and not isinstance(value, str):
                    value = json.dumps(value, ensure_ascii=False)
                params.append(value)
        if not assignments:
            return self.get_generation_task(task_id)
        assignments.append("updated_at = ?")
        params.append(now_iso())
        params.append(task_id)
        with self.connect() as connection:
            connection.execute(
                f"UPDATE generation_tasks SET {', '.join(assignments)} WHERE task_id = ?",
                params,
            )
            row = connection.execute(
                "SELECT * FROM generation_tasks WHERE task_id = ?",
                (task_id,),
            ).fetchone()
            return self._normalize_generation_task(row_to_dict(row), connection) if row else None

    def create_generation_task_event(
        self,
        task_id: str,
        project_id: str,
        phase: str,
        status: str,
        message: str = "",
        asset_id: str = "",
        error_code: str = "",
        error_type: str = "",
        error_message: str = "",
        started_at: str = "",
        finished_at: str = "",
        duration_ms: Optional[int] = None,
        metadata: Optional[Dict[str, Any]] = None,
        tenant_id: str = "",
        workspace_id: str = "",
    ) -> Dict[str, Any]:
        task = self.get_generation_task(task_id) if task_id else None
        project = self.get_project_record(project_id) if project_id else None
        tenant_id = tenant_id or (task or {}).get("tenant_id") or (project or {}).get("tenant_id") or DEFAULT_TENANT_ID
        workspace_id = workspace_id or (task or {}).get("workspace_id") or (project or {}).get("workspace_id") or DEFAULT_WORKSPACE_ID
        with self.connect() as connection:
            cursor = connection.execute(
                """
                INSERT INTO generation_task_events (
                    task_id, tenant_id, workspace_id, project_id, phase, status, message, asset_id,
                    error_code, error_type, error_message, started_at, finished_at,
                    duration_ms, created_at, metadata_json
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    task_id,
                    tenant_id,
                    workspace_id,
                    project_id,
                    phase,
                    status,
                    message,
                    asset_id,
                    error_code,
                    error_type,
                    error_message,
                    started_at,
                    finished_at,
                    duration_ms,
                    now_iso(),
                    json.dumps(metadata, ensure_ascii=False) if metadata is not None else None,
                ),
            )
            row = connection.execute(
                "SELECT * FROM generation_task_events WHERE id = ?",
                (cursor.lastrowid,),
            ).fetchone()
            return self._normalize_generation_task_event(row_to_dict(row))

    def list_generation_tasks(
        self,
        limit: int = 200,
        status: str = "",
        phase: str = "",
        project_id: str = "",
    ) -> List[Dict[str, Any]]:
        sql = "SELECT * FROM generation_tasks WHERE 1 = 1"
        params: List[Any] = []
        if status:
            sql += " AND status = ?"
            params.append(status)
        if phase:
            sql += " AND phase = ?"
            params.append(phase)
        if project_id:
            sql += " AND project_id LIKE ?"
            params.append(f"%{project_id}%")
        sql += " ORDER BY updated_at DESC LIMIT ?"
        params.append(limit)
        with self.connect() as connection:
            rows = connection.execute(sql, params).fetchall()
            return [self._normalize_generation_task(row_to_dict(row), connection) for row in rows]

    def list_generation_tasks_by_project(self, project_id: str) -> List[Dict[str, Any]]:
        with self.connect() as connection:
            rows = connection.execute(
                "SELECT * FROM generation_tasks WHERE project_id = ? ORDER BY updated_at DESC",
                (project_id,),
            ).fetchall()
            return [self._normalize_generation_task(row_to_dict(row), connection) for row in rows]

    def get_generation_task(self, task_id: str) -> Optional[Dict[str, Any]]:
        with self.connect() as connection:
            row = connection.execute(
                "SELECT * FROM generation_tasks WHERE task_id = ?",
                (task_id,),
            ).fetchone()
            return self._normalize_generation_task(row_to_dict(row), connection) if row else None

    def count_generation_tasks(self) -> int:
        with self.connect() as connection:
            return connection.execute("SELECT COUNT(*) AS count FROM generation_tasks").fetchone()["count"]

    def _normalize_generation_task(
        self,
        task: Dict[str, Any],
        connection: sqlite3.Connection,
    ) -> Dict[str, Any]:
        events = connection.execute(
            """
            SELECT *
            FROM generation_task_events
            WHERE task_id = ?
            ORDER BY id ASC
            """,
            (task["task_id"],),
        ).fetchall()
        task = dict(task)
        task["retryable"] = bool(task.get("retryable"))
        task["metadata"] = self._load_json_field(task.pop("metadata_json", None), {})
        task["events"] = [self._normalize_generation_task_event(row_to_dict(row)) for row in events]
        return task

    def _normalize_generation_task_event(self, event: Dict[str, Any]) -> Dict[str, Any]:
        event = dict(event)
        event["metadata"] = self._load_json_field(event.pop("metadata_json", None), {})
        event["event_id"] = str(event.get("id"))
        return event

    def _load_json_field(self, value: Optional[str], fallback: Any):
        if not value:
            return fallback
        try:
            return json.loads(value)
        except Exception:
            return fallback


repository = AdminRepository()
