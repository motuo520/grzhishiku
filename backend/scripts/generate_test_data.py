#!/usr/bin/env python3
"""Generate test data for the Personal Second Brain application."""

import os
import sys
import random
import string
from datetime import datetime, timedelta
from uuid import uuid4

# Add parent dir to path to allow import from app
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from app.core.database import SessionLocal, engine
from app.models.base import (
    User, Note, BrowserClip, KnowledgeUnit, Capsule,
    AttentionActivity, AdminUser,
    SupportTicket, SupportTicketReply, SystemConfig, Tenant,
)
from app.core.security import get_password_hash

# 开发/测试环境管理员密码。生产环境请勿使用默认测试账号。
DEV_ADMIN_PASSWORD = os.environ.get("PSB_DEV_ADMIN_PASSWORD", "dev-admin-password")

try:
    from faker import Faker
    FAKER_AVAILABLE = True
    fake = Faker('zh_CN')
except ImportError:
    FAKER_AVAILABLE = False
    fake = None


def random_date(start, end):
    """Return a random datetime between start and end."""
    delta = end - start
    random_seconds = random.randint(0, int(delta.total_seconds()))
    return start + timedelta(seconds=random_seconds)


def fake_email():
    if FAKER_AVAILABLE:
        return fake.email()
    return f"user_{uuid4().hex[:8]}@example.com"


def fake_name():
    if FAKER_AVAILABLE:
        return fake.name()
    return f"User_{uuid4().hex[:6]}"


def fake_sentence():
    if FAKER_AVAILABLE:
        return fake.sentence(nb_words=random.randint(4, 12))
    return ' '.join(''.join(random.choices(string.ascii_letters + string.digits, k=random.randint(3, 8))) for _ in range(random.randint(5, 15)))


def fake_paragraph():
    if FAKER_AVAILABLE:
        return fake.paragraph(nb_sentences=random.randint(3, 10))
    return '\n'.join(fake_sentence() for _ in range(random.randint(2, 6)))


def generate_users(db, count=50):
    """Generate test users. Only run when GENERATE_FAKE_DATA=1."""
    if os.environ.get('GENERATE_FAKE_DATA') != '1':
        return []
    # Check if admin@test.com and user@test.com already exist
    existing = {u.email for u in db.query(User).all()}
    statuses = ['active', 'active', 'active', 'inactive', 'banned']
    users = []
    for i in range(count):
        email = fake_email() if 'user@example.com' not in existing else fake_email()
        while email in existing:
            email = fake_email()
        existing.add(email)
        user = User(
            id=str(uuid4()),
            email=email,
            name=fake_name(),
            username=f"user_{uuid4().hex[:8]}",
            display_name=fake_name(),
            password_hash=get_password_hash('password123'),
            status=random.choice(statuses),
            storage_used=random.randint(0, 500 * 1024 * 1024),
            storage_limit=random.choice([1073741824, 10737418240, 107374182400]),
            last_login_at=random_date(datetime.utcnow() - timedelta(days=30), datetime.utcnow()) if random.random() > 0.3 else None,
            created_at=random_date(datetime.utcnow() - timedelta(days=365), datetime.utcnow()),
        )
        users.append(user)
    db.add_all(users)
    db.commit()
    return users


def generate_notes(db, users, count=200):
    """Generate notes for users."""
    notes = []
    for _ in range(count):
        user = random.choice(users)
        note = Note(
            id=str(uuid4()),
            user_id=user.id,
            brain_side=random.choice(['personal', 'network', 'both']),
            title=fake_sentence(),
            content=fake_paragraph(),
            content_format='markdown',
            status=random.choice(['active', 'active', 'active', 'pending']),
            is_private=random.choice([True, False]),
            created_at=random_date(datetime.utcnow() - timedelta(days=180), datetime.utcnow()),
            updated_at=random_date(datetime.utcnow() - timedelta(days=30), datetime.utcnow()),
        )
        notes.append(note)
    db.add_all(notes)
    db.commit()


def generate_clips(db, users, count=100):
    """Generate browser clips for users."""
    clips = []
    domains = ['example.com', 'news.site', 'blog.io', 'tech.dev', 'wiki.org']
    for _ in range(count):
        user = random.choice(users)
        domain = random.choice(domains)
        clip = BrowserClip(
            id=str(uuid4()),
            user_id=user.id,
            brain_side=random.choice(['personal', 'network']),
            title=fake_sentence(),
            url=f'https://{domain}/article/{uuid4().hex[:8]}',
            domain=domain,
            excerpt=fake_sentence(),
            full_text=fake_paragraph(),
            status=random.choice(['active', 'active', 'pending']),
            created_at=random_date(datetime.utcnow() - timedelta(days=90), datetime.utcnow()),
            updated_at=random_date(datetime.utcnow() - timedelta(days=30), datetime.utcnow()),
        )
        clips.append(clip)
    db.add_all(clips)
    db.commit()


def generate_knowledge(db, users, count=50):
    """Generate knowledge units for users."""
    knowledge_units = []
    for _ in range(count):
        user = random.choice(users)
        ku = KnowledgeUnit(
            id=str(uuid4()),
            user_id=user.id,
            brain_side=random.choice(['personal', 'network']),
            content_raw=fake_paragraph(),
            content_processed=fake_paragraph(),
            content_type=random.choice(['article', 'book', 'paper', 'video']),
            source_url=f'https://example.com/{uuid4().hex[:8]}',
            source_title=fake_sentence(),
            verification_status=random.choice(['verified', 'unverified', 'pending']),
            status=random.choice(['active', 'active', 'pending']),
            created_at=random_date(datetime.utcnow() - timedelta(days=120), datetime.utcnow()),
            updated_at=random_date(datetime.utcnow() - timedelta(days=30), datetime.utcnow()),
        )
        knowledge_units.append(ku)
    db.add_all(knowledge_units)
    db.commit()


def generate_capsules(db, users, count=30):
    """Generate time capsules for users."""
    capsules = []
    for _ in range(count):
        user = random.choice(users)
        capsule = Capsule(
            id=str(uuid4()),
            user_id=user.id,
            brain_side=random.choice(['personal', 'network']),
            content_type=random.choice(['text', 'image', 'audio']),
            content_body=fake_paragraph(),
            unlock_type=random.choice(['date', 'mood', 'manual']),
            unlock_config='{"date": "2026-01-01"}',
            unlock_status=random.choice(['locked', 'unlocked']),
            privacy_level=random.choice(['private', 'shared', 'public']),
            status='active',
            created_at=random_date(datetime.utcnow() - timedelta(days=60), datetime.utcnow()),
            updated_at=random_date(datetime.utcnow() - timedelta(days=30), datetime.utcnow()),
        )
        capsules.append(capsule)
    db.add_all(capsules)
    db.commit()


def generate_attention_activities(db, users, count=100):
    """Generate attention activities for users."""
    activities = []
    categories = ['work', 'study', 'entertainment', 'social', 'other']
    for _ in range(count):
        user = random.choice(users)
        start = random_date(datetime.utcnow() - timedelta(days=30), datetime.utcnow())
        duration = random.randint(300, 7200)
        end = start + timedelta(seconds=duration)
        activity = AttentionActivity(
            id=str(uuid4()),
            user_id=user.id,
            category_id=str(uuid4()),
            category=random.choice(categories),
            activity_source=random.choice(['browser', 'app', 'manual']),
            description=fake_sentence(),
            start_time=start,
            end_time=end,
            actual_duration=duration,
            focus_score=random.uniform(0.3, 1.0),
            focus_duration=random.uniform(0.5, 1.0) * duration,
            created_at=start,
        )
        activities.append(activity)
    db.add_all(activities)
    db.commit()


def generate_support_tickets(db, users, count=15):
    """Generate support tickets and replies."""
    categories = ['bug', 'feature', 'feedback', 'account']
    priorities = ['low', 'medium', 'high', 'urgent']
    statuses = ['open', 'in_progress', 'resolved', 'closed']
    for _ in range(count):
        user = random.choice(users)
        ticket = SupportTicket(
            id=str(uuid4()),
            user_id=user.id,
            user_email=user.email,
            subject=fake_sentence(),
            description=fake_paragraph(),
            status=random.choice(statuses),
            priority=random.choice(priorities),
            category=random.choice(categories),
            created_at=random_date(datetime.utcnow() - timedelta(days=60), datetime.utcnow()),
            updated_at=random_date(datetime.utcnow() - timedelta(days=7), datetime.utcnow()),
        )
        db.add(ticket)
        db.commit()
        # Add a reply sometimes
        if random.random() > 0.5:
            reply = SupportTicketReply(
                id=str(uuid4()),
                ticket_id=ticket.id,
                user_id=user.id,
                user_email=user.email,
                is_admin=False,
                content=fake_paragraph(),
                created_at=ticket.created_at + timedelta(hours=random.randint(1, 24)),
            )
            db.add(reply)
            db.commit()


def generate_admin_user(db):
    """Ensure admin user exists."""
    admin = db.query(AdminUser).filter(AdminUser.email == 'admin@test.com').first()
    if not admin:
        admin = AdminUser(
            id=str(uuid4()),
            email='admin@test.com',
            name='Admin',
            password_hash=get_password_hash(DEV_ADMIN_PASSWORD),
            role='super_admin',
            status='active',
            created_at=datetime.utcnow(),
        )
        db.add(admin)
        db.commit()


def ensure_base_users(db):
    """Ensure admin@test.com exists with the production password."""
    admin = db.query(User).filter(User.email == 'admin@test.com').first()
    if not admin:
        admin = User(
            id=str(uuid4()),
            email='admin@test.com',
            name='Admin User',
            username='admin',
            display_name='Admin',
            password_hash=get_password_hash(DEV_ADMIN_PASSWORD),
            status='active',
            created_at=datetime.utcnow() - timedelta(days=30),
        )
        db.add(admin)
    # 不再创建 user@test.com 测试账号
    db.commit()


def main():
    db = SessionLocal()
    try:
        # Ensure DB schema columns exist for newer models (SQLite ALTER TABLE for missing columns)
        from sqlalchemy import inspect, text
        inspector = inspect(engine)
        if 'users' in inspector.get_table_names():
            columns = [c['name'] for c in inspector.get_columns('users')]
            with engine.begin() as conn:
                if 'settings' not in columns:
                    conn.execute(text("ALTER TABLE users ADD COLUMN settings TEXT DEFAULT '{}'"))
                if 'active_brain' not in columns:
                    conn.execute(text("ALTER TABLE users ADD COLUMN active_brain TEXT DEFAULT 'personal'"))
        if 'knowledge_units' in inspector.get_table_names():
            columns = [c['name'] for c in inspector.get_columns('knowledge_units')]
            with engine.begin() as conn:
                if 'verification_history' not in columns:
                    conn.execute(text("ALTER TABLE knowledge_units ADD COLUMN verification_history TEXT DEFAULT '[]'"))
        if 'graph_edges' in inspector.get_table_names():
            columns = [c['name'] for c in inspector.get_columns('graph_edges')]
            with engine.begin() as conn:
                if 'weight' not in columns:
                    conn.execute(text("ALTER TABLE graph_edges ADD COLUMN weight REAL DEFAULT 1.0"))
                if 'auto_created' not in columns:
                    conn.execute(text("ALTER TABLE graph_edges ADD COLUMN auto_created INTEGER DEFAULT 0"))
        if 'support_tickets' in inspector.get_table_names():
            columns = [c['name'] for c in inspector.get_columns('support_tickets')]
            with engine.begin() as conn:
                if 'satisfaction' not in columns:
                    conn.execute(text("ALTER TABLE support_tickets ADD COLUMN satisfaction INTEGER"))
        if 'support_ticket_replies' not in inspector.get_table_names():
            with engine.begin() as conn:
                conn.execute(text("""
                    CREATE TABLE IF NOT EXISTS support_ticket_replies (
                        id TEXT PRIMARY KEY,
                        ticket_id TEXT NOT NULL,
                        user_id TEXT NOT NULL,
                        user_email TEXT NOT NULL,
                        is_admin INTEGER DEFAULT 0,
                        content TEXT NOT NULL,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    )
                """))
        # Ensure base users exist
        ensure_base_users(db)
        generate_admin_user(db)

        # Fetch all existing users
        all_users = db.query(User).all()
        if len(all_users) < 2:
            print("Need at least base users to generate data.")
            return

        # Generate data
        print("Generating 50 users...")
        new_users = generate_users(db, count=50)
        all_users = db.query(User).all()

        print("Generating 200 notes...")
        generate_notes(db, all_users, count=200)

        print("Generating 100 clips...")
        generate_clips(db, all_users, count=100)

        print("Generating 50 knowledge units...")
        generate_knowledge(db, all_users, count=50)

        print("Generating 30 capsules...")
        generate_capsules(db, all_users, count=30)

        print("Generating 100 attention activities...")
        generate_attention_activities(db, all_users, count=100)

        print("Generating 15 support tickets...")
        generate_support_tickets(db, all_users, count=15)

        print("Test data generation complete!")
    except Exception as e:
        print(f"Error generating test data: {e}")
        import traceback
        traceback.print_exc()
    finally:
        db.close()


if __name__ == '__main__':
    main()
