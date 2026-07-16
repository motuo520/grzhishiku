from fastapi import Request, HTTPException, Depends
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.models.base import Tenant

class TenantContext:
    """Tenant context manager for multi-tenant requests."""
    
    def __init__(self, tenant_id: str = None):
        self.tenant_id = tenant_id
    
    def filter_query(self, query):
        """Apply tenant filter to a query if tenant_id is set."""
        if self.tenant_id:
            # Get the model from the query and check for tenant_id column
            model = query.column_descriptions[0]['entity'] if query.column_descriptions else None
            if model and hasattr(model, 'tenant_id'):
                query = query.filter(model.tenant_id == self.tenant_id)
        return query

async def get_tenant_context(
    request: Request,
    db: Session = Depends(get_db)
) -> TenantContext:
    """Extract tenant from request headers and validate."""
    tenant_id = request.headers.get("X-Tenant-ID")
    
    if tenant_id:
        tenant = db.query(Tenant).filter(
            Tenant.id == tenant_id,
            Tenant.status == "active"
        ).first()
        if not tenant:
            raise HTTPException(status_code=403, detail="Invalid or inactive tenant")
    
    return TenantContext(tenant_id=tenant_id)

def require_tenant(tenant_ctx: TenantContext = Depends(get_tenant_context)):
    """Require tenant context for routes."""
    if not tenant_ctx.tenant_id:
        raise HTTPException(status_code=403, detail="Tenant context required")
    return tenant_ctx
