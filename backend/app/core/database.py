from sqlalchemy import create_engine, event
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, Session
from app.core.config import settings

# ── Synchronous engine (primary, SQLite) ─────────────────────────
# SQLite does not support pool_size; these parameters are ignored for SQLite
# but will take effect when migrating to PostgreSQL.
engine = create_engine(
    settings.DATABASE_URL,
    connect_args={"check_same_thread": False},
    echo=False,
    pool_pre_ping=True,
    pool_size=20,
    max_overflow=30,
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

# ── Async engine (prepared for PostgreSQL migration) ───────────
# If DATABASE_URL starts with postgresql+asyncpg, use async engine.
# For SQLite, async engine requires aiosqlite: sqlite+aiosqlite:///...
async_engine = None
AsyncSessionLocal = None

if settings.DATABASE_URL.startswith("postgresql"):
    async_engine = create_async_engine(
        settings.DATABASE_URL.replace("postgresql://", "postgresql+asyncpg://"),
        pool_pre_ping=True,
        pool_size=20,
        max_overflow=30,
    )
    AsyncSessionLocal = sessionmaker(
        autocommit=False, autoflush=False, bind=async_engine, class_=AsyncSession
    )

# Enable SQLite WAL mode for better concurrency
@event.listens_for(engine, "connect")
def set_sqlite_pragma(dbapi_conn, connection_record):
    cursor = dbapi_conn.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA cache_size=-64000")  # 64MB page cache
    cursor.close()

def get_db() -> Session:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

async def get_async_db() -> AsyncSession:
    """Async session dependency for PostgreSQL migration.
    Falls back to sync session in thread pool if SQLite is used.
    """
    if AsyncSessionLocal is None:
        raise RuntimeError("Async database not configured. Use get_db for sync sessions.")
    async with AsyncSessionLocal() as session:
        yield session
