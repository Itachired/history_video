def register_admin_routes(app):
    from .routes import register_admin_routes as _register_admin_routes

    return _register_admin_routes(app)


__all__ = ["register_admin_routes"]
