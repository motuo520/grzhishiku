import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker, Session
from sqlalchemy.pool import StaticPool
from app.core.database import Base, get_db
from app.main import app
from app.models.base import User, Note, BrowserClip, KnowledgeUnit, Capsule
from app.core.security import get_password_hash, create_access_token
import uuid
from datetime import datetime, timedelta, timezone

# Test database (SQLite in-memory shared across connections via StaticPool)
TEST_DATABASE_URL = "sqlite:///:memory:"
engine = create_engine(
    TEST_DATABASE_URL,
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)

@event.listens_for(engine, "connect")
def set_sqlite_pragma(dbapi_conn, connection_record):
    cursor = dbapi_conn.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()

TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

@pytest.fixture(scope="session", autouse=True)
def setup_test_database():
    Base.metadata.create_all(bind=engine)
    yield
    Base.metadata.drop_all(bind=engine)


@pytest.fixture(autouse=True)
def reset_verification_store():
    """Clear the in-memory email-verification store before each test.

    The store enforces a 60s resend cooldown per email; without a reset,
    tests that re-register the same email would hit 429s from shared state."""
    from app.services import verification_service

    with verification_service._lock:
        verification_service._store.clear()
    yield


@pytest.fixture
def get_verification_code(client):
    """Return a factory that requests a real email verification code through the
    API and reads it back from the in-memory verification store."""
    from app.services import verification_service

    def _get_code(email: str) -> str:
        resp = client.post("/api/v1/auth/send-verification-code", json={"email": email})
        assert resp.status_code == 200
        record = verification_service._store.get(email.strip().lower())
        assert record, f"no verification code stored for {email}"
        return record["code"]

    return _get_code


@pytest.fixture
def register_user(client, get_verification_code):
    """Register a user through the real verification-code flow; returns the response."""
    def _register(email: str, password: str = "TestPass123"):
        return client.post("/api/v1/auth/register", json={
            "email": email,
            "password": password,
            "verification_code": get_verification_code(email),
        })

    return _register


@pytest.fixture
def db_session() -> Session:
    connection = engine.connect()
    transaction = connection.begin()
    session = TestingSessionLocal(bind=connection)
    # Use a connection-level SAVEPOINT so that tests/routes may call
    # session.commit() without committing the enclosing transaction.
    # Rolling back the outer connection transaction at teardown undoes
    # everything created inside the savepoint.
    connection.begin_nested()

    # If test code explicitly uses session.begin_nested() and commits that
    # savepoint, start a fresh one so the outer rollback can still clean up.
    @event.listens_for(session, "after_transaction_end")
    def restart_savepoint(session, transaction):
        if transaction.nested and not transaction._parent.nested:
            session.expire_all()
            session.begin_nested()

    yield session

    session.close()
    transaction.rollback()
    connection.close()

@pytest.fixture
def client(db_session):
    def override_get_db():
        try:
            yield db_session
        finally:
            pass
    # Save any existing override (e.g. test_e2e sets one at module import) and restore it
    # after the test so that module-level overrides are not accidentally cleared.
    original_override = app.dependency_overrides.get(get_db)
    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as test_client:
        yield test_client
    if original_override is None:
        app.dependency_overrides.pop(get_db, None)
    else:
        app.dependency_overrides[get_db] = original_override

@pytest.fixture
def test_user(db_session):
    user = User(
        id=str(uuid.uuid4()),
        email="test@example.com",
        name="Test User",
        password_hash=get_password_hash("TestPass123"),
        status="active",
        created_at=datetime.now(timezone.utc),
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user

@pytest.fixture
def test_user_token(test_user):
    token = create_access_token(
        data={"sub": test_user.id, "email": test_user.email},
        expires_delta=timedelta(days=1)
    )
    return token

@pytest.fixture
def auth_headers(test_user_token):
    return {"Authorization": f"Bearer {test_user_token}"}

@pytest.fixture
def test_note(db_session, test_user):
    note = Note(
        id=str(uuid.uuid4()),
        user_id=test_user.id,
        title="Test Note",
        content="This is a test note content.",
        status="active",
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    db_session.add(note)
    db_session.commit()
    db_session.refresh(note)
    return note

@pytest.fixture
def test_clip(db_session, test_user):
    clip = BrowserClip(
        id=str(uuid.uuid4()),
        user_id=test_user.id,
        title="Test Clip",
        url="https://example.com/article",
        domain="example.com",
        excerpt="Test excerpt",
        status="active",
        created_at=datetime.now(timezone.utc),
    )
    db_session.add(clip)
    db_session.commit()
    db_session.refresh(clip)
    return clip

@pytest.fixture
def test_knowledge(db_session, test_user):
    ku = KnowledgeUnit(
        id=str(uuid.uuid4()),
        user_id=test_user.id,
        content_raw="Test knowledge content",
        verification_status="unverified",
        status="active",
        created_at=datetime.now(timezone.utc),
    )
    db_session.add(ku)
    db_session.commit()
    db_session.refresh(ku)
    return ku

@pytest.fixture
def test_capsule(db_session, test_user):
    capsule = Capsule(
        id=str(uuid.uuid4()),
        user_id=test_user.id,
        content_body="Test capsule content",
        unlock_config='{"date": "2025-01-01"}',
        unlock_status="locked",
        status="active",
        created_at=datetime.now(timezone.utc),
    )
    db_session.add(capsule)
    db_session.commit()
    db_session.refresh(capsule)
    return capsule

@pytest.fixture
def admin_user(db_session):
    from app.models.base import AdminUser
    admin = AdminUser(
        id=str(uuid.uuid4()),
        email="admin@example.com",
        name="Admin User",
        password_hash=get_password_hash("AdminPass123"),
        role="super_admin",
        status="active",
        created_at=datetime.now(timezone.utc),
    )
    db_session.add(admin)
    db_session.commit()
    db_session.refresh(admin)
    return admin

