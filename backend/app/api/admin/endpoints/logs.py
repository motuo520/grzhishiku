from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import func, and_
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
from datetime import datetime, timedelta
import uuid
import json
import csv
import io

from app.core.database import get_db
from app.core.admin_permissions import Permission, require_permission
from app.models.base import AdminAuditLog, AdminUser
from app.api.admin.endpoints.auth import get_current_admin

router = APIRouter()


class LogListParams(BaseModel):
    action: Optional[str] = None
    risk_level: Optional[str] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    admin_id: Optional[str] = None
    search: Optional[str] = None
    skip: int = 0
    limit: int = 50


class LogEntry(BaseModel):
    id: str
    admin_id: str
    admin_name: str
    action: str
    resource_type: str
    resource_id: str
    before_state: Optional[Dict[str, Any]]
    after_state: Optional[Dict[str, Any]]
    changes: Optional[Dict[str, Any]]
    risk_level: str
    ip_address: Optional[str]
    created_at: datetime


@router.get("/", summary="List audit logs", description="List all admin audit logs with filtering, pagination and search.")
async def list_logs(
    action: Optional[str] = Query(None, description="Filter by action type: CREATE/UPDATE/DELETE/LOGIN/EXPORT/MODERATE_CONTENT/UPDATE_USER_STATUS/UPDATE_SUBSCRIPTION"),
    risk_level: Optional[str] = Query(None, description="Filter by risk level: low/medium/high/critical"),
    start_date: Optional[str] = Query(None, description="Start date YYYY-MM-DD"),
    end_date: Optional[str] = Query(None, description="End date YYYY-MM-DD"),
    admin_id: Optional[str] = Query(None, description="Filter by admin ID"),
    search: Optional[str] = Query(None, description="Search by resource ID or admin name"),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    current_admin: AdminUser = Depends(require_permission(Permission.LOGS_READ))
):
    query = db.query(AdminAuditLog)

    if action:
        query = query.filter(AdminAuditLog.action == action)
    if risk_level:
        query = query.filter(AdminAuditLog.risk_level == risk_level)
    if admin_id:
        query = query.filter(AdminAuditLog.admin_id == admin_id)
    if start_date:
        try:
            start_dt = datetime.strptime(start_date, "%Y-%m-%d")
            query = query.filter(AdminAuditLog.created_at >= start_dt)
        except ValueError:
            pass
    if end_date:
        try:
            end_dt = datetime.strptime(end_date, "%Y-%m-%d") + timedelta(days=1)
            query = query.filter(AdminAuditLog.created_at < end_dt)
        except ValueError:
            pass
    if search:
        query = query.filter(
            and_(
                AdminAuditLog.resource_id.ilike(f"%{search}%"),
            )
        )
        # Also search by admin name if matches
        admin_match = db.query(AdminUser).filter(AdminUser.name.ilike(f"%{search}%")).all()
        if admin_match:
            admin_ids = [a.id for a in admin_match]
            query = query.filter(
                and_(
                    AdminAuditLog.admin_id.in_(admin_ids) | AdminAuditLog.resource_id.ilike(f"%{search}%")
                )
            )

    total = query.count()
    logs = query.order_by(AdminAuditLog.created_at.desc()).offset(skip).limit(limit).all()

    admins = {a.id: a for a in db.query(AdminUser).all()}
    result = []
    for log in logs:
        admin = admins.get(log.admin_id)
        result.append({
            "id": log.id,
            "admin_id": log.admin_id,
            "admin_name": admin.name if admin else "Unknown",
            "admin_role": admin.role if admin else "unknown",
            "action": log.action,
            "resource_type": log.resource_type or "",
            "resource_id": log.resource_id or "",
            "target_type": log.resource_type or "",
            "target_id": log.resource_id or "",
            "before_state": json.loads(log.before_state) if log.before_state else None,
            "after_state": json.loads(log.after_state) if log.after_state else None,
            "changes": json.loads(log.changes) if log.changes else None,
            "diff": json.loads(log.changes) if log.changes else None,
            "risk_level": log.risk_level or "low",
            "risk_reason": log.risk_reason or "",
            "severity": log.risk_level or "low",
            "ip_address": log.ip_address or "",
            "created_at": log.created_at,
        })

    return {
        "total": total,
        "skip": skip,
        "limit": limit,
        "items": result,
    }


@router.get("/export", summary="Export audit logs", description="Export audit logs as CSV or JSON.")
async def export_logs(
    format: str = Query("csv", description="Export format: csv or json"),
    action: Optional[str] = Query(None),
    risk_level: Optional[str] = Query(None),
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_admin: AdminUser = Depends(require_permission(Permission.LOGS_READ))
):
    query = db.query(AdminAuditLog)
    if action:
        query = query.filter(AdminAuditLog.action == action)
    if risk_level:
        query = query.filter(AdminAuditLog.risk_level == risk_level)
    if start_date:
        try:
            start_dt = datetime.strptime(start_date, "%Y-%m-%d")
            query = query.filter(AdminAuditLog.created_at >= start_dt)
        except ValueError:
            pass
    if end_date:
        try:
            end_dt = datetime.strptime(end_date, "%Y-%m-%d") + timedelta(days=1)
            query = query.filter(AdminAuditLog.created_at < end_dt)
        except ValueError:
            pass

    logs = query.order_by(AdminAuditLog.created_at.desc()).all()
    admins = {a.id: a for a in db.query(AdminUser).all()}

    if format == "csv":
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow([
            "ID", "Admin Name", "Action", "Resource Type", "Resource ID",
            "Risk Level", "IP Address", "Details", "Created At"
        ])
        for log in logs:
            admin = admins.get(log.admin_id)
            writer.writerow([
                log.id,
                admin.name if admin else "Unknown",
                log.action,
                log.resource_type or "",
                log.resource_id or "",
                log.risk_level or "low",
                log.ip_address or "",
                log.details or "",
                log.created_at.isoformat() if log.created_at else "",
            ])
        output.seek(0)
        from fastapi.responses import PlainTextResponse
        return PlainTextResponse(
            content=output.getvalue(),
            media_type="text/csv",
            headers={"Content-Disposition": "attachment; filename=audit_logs.csv"}
        )
    else:
        result = []
        for log in logs:
            admin = admins.get(log.admin_id)
            result.append({
                "id": log.id,
                "admin_name": admin.name if admin else "Unknown",
                "action": log.action,
                "resource_type": log.resource_type,
                "resource_id": log.resource_id,
                "risk_level": log.risk_level,
                "ip_address": log.ip_address,
                "details": log.details,
                "created_at": log.created_at.isoformat() if log.created_at else None,
            })
        from fastapi.responses import JSONResponse
        return JSONResponse(
            content=result,
            headers={"Content-Disposition": "attachment; filename=audit_logs.json"}
        )


@router.get("/stats", summary="Audit log stats", description="Get audit log statistics.")
async def get_log_stats(
    db: Session = Depends(get_db),
    current_admin: AdminUser = Depends(require_permission(Permission.LOGS_READ))
):
    total = db.query(func.count(AdminAuditLog.id)).scalar()
    today = datetime.utcnow().date()
    today_start = datetime.combine(today, datetime.min.time())
    today_count = db.query(func.count(AdminAuditLog.id)).filter(AdminAuditLog.created_at >= today_start).scalar()

    action_counts = {}
    for action in db.query(AdminAuditLog.action, func.count(AdminAuditLog.id)).group_by(AdminAuditLog.action).all():
        action_counts[action.action] = action[1]

    risk_counts = {}
    for risk in db.query(AdminAuditLog.risk_level, func.count(AdminAuditLog.id)).group_by(AdminAuditLog.risk_level).all():
        risk_counts[risk.risk_level or "low"] = risk[1]

    return {
        "total": total,
        "today": today_count,
        "action_counts": action_counts,
        "risk_counts": risk_counts,
    }


def create_audit_log(
    db: Session,
    admin: AdminUser,
    action: str,
    resource_type: str,
    resource_id: str,
    before_state: Optional[Dict[str, Any]] = None,
    after_state: Optional[Dict[str, Any]] = None,
    changes: Optional[Dict[str, Any]] = None,
    risk_level: str = "low",
    risk_reason: str = "",
    ip_address: str = "",
    details: str = "",
):
    """Helper to create an audit log entry."""
    log = AdminAuditLog(
        id=str(uuid.uuid4()),
        admin_id=admin.id,
        admin_name=admin.name,
        admin_role=admin.role,
        action=action,
        resource_type=resource_type,
        resource_id=resource_id,
        before_state=json.dumps(before_state, default=str) if before_state else None,
        after_state=json.dumps(after_state, default=str) if after_state else None,
        changes=json.dumps(changes, default=str) if changes else None,
        risk_level=risk_level,
        risk_reason=risk_reason,
        ip_address=ip_address,
        details=details,
    )
    db.add(log)
    db.commit()
    return log
