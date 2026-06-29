from fastapi import FastAPI

from ..repository import repository
from .audit import router as audit_router
from .auth import router as auth_router
from .billing import router as billing_router
from .dashboard import router as dashboard_router
from .organizations import router as organizations_router
from .projects import router as projects_router
from .roles import router as roles_router
from .system import router as system_router
from .tasks import router as tasks_router
from .users import router as users_router


def register_admin_routes(app: FastAPI):
    repository.init_db()
    app.include_router(auth_router)
    app.include_router(dashboard_router)
    app.include_router(users_router)
    app.include_router(roles_router)
    app.include_router(organizations_router)
    app.include_router(projects_router)
    app.include_router(tasks_router)
    app.include_router(billing_router)
    app.include_router(audit_router)
    app.include_router(system_router)
