from contextvars import ContextVar
from typing import Any, Dict


_billing_context: ContextVar[Dict[str, Any]] = ContextVar("billing_context", default={})


def set_billing_context(value: Dict[str, Any]):
    return _billing_context.set(dict(value or {}))


def reset_billing_context(token):
    _billing_context.reset(token)


def get_billing_context() -> Dict[str, Any]:
    return dict(_billing_context.get() or {})
