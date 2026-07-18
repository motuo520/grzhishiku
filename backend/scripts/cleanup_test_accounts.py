#!/usr/bin/env python3
"""清理测试/假账号，并确保管理员密码正确。"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from app.core.database import SessionLocal
from app.models.base import User, AdminUser
from app.core.security import get_password_hash
from sqlalchemy import text

# 开发/测试环境管理员密码，需与 generate_test_data.py 保持一致。
DEV_ADMIN_PASSWORD = os.environ.get("PSB_DEV_ADMIN_PASSWORD", "dev-admin-password")


def main():
    db = SessionLocal()
    try:
        # 关闭外键约束以级联清理关联数据
        db.execute(text("PRAGMA foreign_keys = OFF"))

        # 1) 删除 user@test.com
        removed_user_test = db.query(User).filter(User.email == 'user@test.com').delete()
        print(f"删除 user@test.com: {removed_user_test} 条")

        # 2) 删除脚本生成的假账号（example.com 邮箱）
        removed_fake = db.query(User).filter(User.email.like('%@example.com')).delete(synchronize_session=False)
        print(f"删除 @example.com 假账号: {removed_fake} 条")

        # 3) 重置管理员密码
        admin_user = db.query(User).filter(User.email == 'admin@test.com').first()
        if admin_user:
            admin_user.password_hash = get_password_hash(DEV_ADMIN_PASSWORD)
            print("已重置 User 表 admin@test.com 密码")

        admin_record = db.query(AdminUser).filter(AdminUser.email == 'admin@test.com').first()
        if admin_record:
            admin_record.password_hash = get_password_hash(DEV_ADMIN_PASSWORD)
            print("已重置 AdminUser 表 admin@test.com 密码")

        db.commit()
        db.execute(text("PRAGMA foreign_keys = ON"))
        print("清理完成")
    except Exception as e:
        db.rollback()
        db.execute(text("PRAGMA foreign_keys = ON"))
        print(f"清理失败: {e}")
        import traceback
        traceback.print_exc()
    finally:
        db.close()


if __name__ == '__main__':
    main()
