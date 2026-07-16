"""Prometheus metrics for monitoring."""
from prometheus_client import Counter, Histogram, Gauge, generate_latest, CONTENT_TYPE_LATEST
from fastapi import Response
import time

# Request metrics
request_count = Counter(
    'http_requests_total',
    'Total HTTP requests',
    ['method', 'endpoint', 'status']
)

request_duration = Histogram(
    'http_request_duration_seconds',
    'HTTP request duration',
    ['method', 'endpoint']
)

# Business metrics
active_users = Gauge(
    'active_users_total',
    'Total active users'
)

total_notes = Gauge(
    'total_notes',
    'Total notes in system'
)

total_capsules = Gauge(
    'total_capsules',
    'Total capsules in system'
)

total_clips = Gauge(
    'total_clips',
    'Total browser clips'
)

# LLM metrics
llm_requests = Counter(
    'llm_requests_total',
    'Total LLM API requests',
    ['provider', 'model']
)

llm_request_duration = Histogram(
    'llm_request_duration_seconds',
    'LLM API request duration',
    ['provider', 'model']
)

def record_request(method: str, endpoint: str, status: int, duration: float):
    request_count.labels(method=method, endpoint=endpoint, status=status).inc()
    request_duration.labels(method=method, endpoint=endpoint).observe(duration)

def record_llm_request(provider: str, model: str, duration: float):
    llm_requests.labels(provider=provider, model=model).inc()
    llm_request_duration.labels(provider=provider, model=model).observe(duration)

def update_business_metrics(db):
    from sqlalchemy import func
    from app.models.base import User, Note, Capsule, BrowserClip
    
    active_users.set(db.query(func.count(User.id)).filter(User.status == "active").scalar())
    total_notes.set(db.query(func.count(Note.id)).scalar())
    total_capsules.set(db.query(func.count(Capsule.id)).scalar())
    total_clips.set(db.query(func.count(BrowserClip.id)).scalar())

def get_metrics():
    return Response(content=generate_latest(), media_type=CONTENT_TYPE_LATEST)
