"""创建/重置管理员账号（README 快速开始引用此脚本）。

用法:
    python -m scripts.create_admin admin@example.com [--name 管理员] [--role super_admin]
    python -m scripts.create_admin admin@example.com --password 'YourPass123'

不带 --password 时会交互式输入（推荐，避免密码留在 shell 历史里）。
账号已存在时重置其密码与角色。
"""
import argparse
import getpass
import sys
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.core.database import SessionLocal
from app.core.security import get_password_hash, validate_password_complexity
from app.models.admin import AdminUser


def main() -> None:
    parser = argparse.ArgumentParser(description="创建或重置管理员账号")
    parser.add_argument("email", help="管理员邮箱")
    parser.add_argument("--name", default="管理员", help="显示名称")
    parser.add_argument("--role", default="super_admin", help="角色（默认 super_admin）")
    parser.add_argument("--password", help="明文密码（不传则交互式输入）")
    args = parser.parse_args()

    password = args.password or getpass.getpass("管理员密码: ")
    if not validate_password_complexity(password):
        print("密码至少 8 位，需包含大小写字母和数字", file=sys.stderr)
        sys.exit(1)

    db = SessionLocal()
    try:
        admin = db.query(AdminUser).filter(AdminUser.email == args.email).first()
        if admin:
            admin.password_hash = get_password_hash(password)
            admin.role = args.role
            admin.status = "active"
            if args.name:
                admin.name = args.name
            action = "已重置"
        else:
            admin = AdminUser(
                id=str(uuid.uuid4()),
                email=args.email,
                name=args.name,
                password_hash=get_password_hash(password),
                role=args.role,
                status="active",
            )
            db.add(admin)
            action = "已创建"
        db.commit()
        print(f"{action}管理员: {args.email} (role={args.role})")
    finally:
        db.close()


if __name__ == "__main__":
    main()
