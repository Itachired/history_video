from typing import Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

from ..dependencies import require_permission
from ..repository import repository
from ..scope import data_scope_for_user, record_in_scope


router = APIRouter(prefix="/v1/admin/billing", tags=["admin-billing"])


class PriceRulePayload(BaseModel):
    code: Optional[str] = None
    tenant_id: str = ""
    workspace_id: str = ""
    provider: str = "volcengine"
    model: str = ""
    endpoint_id: str = ""
    resource_type: str = "llm_token"
    phase: str = ""
    input_price_per_1m_tokens: float = 0
    output_price_per_1m_tokens: float = 0
    cached_input_price_per_1m_tokens: float = 0
    reasoning_price_per_1m_tokens: float = 0
    currency: str = "CNY"
    enabled: bool = True
    effective_from: str = ""
    effective_to: str = ""


@router.get("/summary")
async def billing_summary(current_user=Depends(require_permission("billing:read"))):
    return repository.billing_summary(scope=data_scope_for_user(current_user))


@router.get("/projects")
async def billing_projects(
    limit: int = Query(default=100, ge=1, le=500),
    current_user=Depends(require_permission("billing:read")),
):
    return {"projects": repository.billing_project_summaries(limit=limit, scope=data_scope_for_user(current_user))}


@router.get("/tasks")
async def billing_tasks(
    limit: int = Query(default=100, ge=1, le=500),
    project_id: str = Query(default=""),
    current_user=Depends(require_permission("billing:read")),
):
    return {
        "tasks": repository.billing_task_summaries(
            limit=limit,
            project_id=project_id,
            scope=data_scope_for_user(current_user),
        )
    }


@router.get("/usage-events")
async def usage_events(
    limit: int = Query(default=100, ge=1, le=500),
    project_id: str = Query(default=""),
    task_id: str = Query(default=""),
    tenant_id: str = Query(default=""),
    workspace_id: str = Query(default=""),
    current_user=Depends(require_permission("billing:read")),
):
    return {
        "events": repository.list_token_usage_events(
            limit=limit,
            project_id=project_id,
            task_id=task_id,
            tenant_id=tenant_id,
            workspace_id=workspace_id,
            scope=data_scope_for_user(current_user),
        )
    }


@router.get("/price-rules")
async def list_price_rules(current_user=Depends(require_permission("billing:read"))):
    scope = data_scope_for_user(current_user)
    rules = repository.list_price_rules()
    if not scope.is_all:
        rules = [
            rule
            for rule in rules
            if (not rule.get("tenant_id") and not rule.get("workspace_id")) or record_in_scope(rule, scope)
        ]
    return {"rules": rules}


@router.post("/price-rules")
async def create_price_rule(
    payload: PriceRulePayload,
    current_user=Depends(require_permission("billing:price:update")),
):
    rule = repository.create_price_rule(payload.model_dump())
    repository.create_audit_log(
        "billing.price_rule.create",
        "billing_price_rule",
        str(rule["id"]),
        actor=current_user,
        after=rule,
    )
    return {"rule": rule}


@router.patch("/price-rules/{rule_id}")
async def update_price_rule(
    rule_id: int,
    payload: PriceRulePayload,
    current_user=Depends(require_permission("billing:price:update")),
):
    before = next((rule for rule in repository.list_price_rules() if int(rule["id"]) == rule_id), None)
    rule = repository.update_price_rule(rule_id, payload.model_dump(exclude_unset=True))
    repository.create_audit_log(
        "billing.price_rule.update",
        "billing_price_rule",
        str(rule_id),
        actor=current_user,
        before=before,
        after=rule,
    )
    return {"rule": rule}
