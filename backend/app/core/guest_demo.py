"""游客演示模式：未登录的 GET 请求自动注入只读演示账号。

让未注册访客打开应用就能看到一套完整的演示数据（而不是全空白页），
注册后才创建自己的知识库。写操作（POST/PUT/DELETE）不受影响，仍需登录。

- 演示账号邮箱由 settings.GUEST_DEMO_EMAIL 指定（默认 demo@wenmo.local）；
  该账号不存在时中间件自动失效（自托管不播种演示账号 = 功能自然关闭）。
- settings.GUEST_DEMO_ENABLED = False 可整体关闭。
- 启动时在 lifespan 里为演示账号铸一张长效 token 缓存于 app.state。
"""
import logging
from datetime import timedelta

from starlette.middleware.base import BaseHTTPMiddleware

from app.core.config import settings

logger = logging.getLogger(__name__)

_READ_PREFIXES = ("/api/v1/",)


def init_guest_demo_token(app) -> None:
    """在应用启动时调用：为演示账号铸 token 并缓存到 app.state。"""
    app.state.guest_demo_token = None
    if not settings.GUEST_DEMO_ENABLED:
        return
    from app.core.database import SessionLocal
    from app.core.security import create_access_token
    from app.models.base import User

    db = SessionLocal()
    try:
        user = db.query(User).filter(User.email == settings.GUEST_DEMO_EMAIL).first()
        if not user:
            logger.info("游客演示模式：未找到演示账号 %s，功能未启用", settings.GUEST_DEMO_EMAIL)
            return
        app.state.guest_demo_token = create_access_token(
            {"sub": user.id}, expires_delta=timedelta(days=3650)
        )
        logger.info("游客演示模式已启用（%s）", settings.GUEST_DEMO_EMAIL)
    except Exception as e:  # 数据库未就绪等场景下静默降级
        logger.warning("游客演示模式初始化失败（已跳过）: %s", e)
    finally:
        db.close()


class GuestDemoMiddleware(BaseHTTPMiddleware):
    """未携带凭证的只读 API 请求注入演示账号 token。"""

    async def dispatch(self, request, call_next):
        token = getattr(request.app.state, "guest_demo_token", None)
        if (
            token
            and request.method == "GET"
            and request.url.path.startswith(_READ_PREFIXES)
            and "authorization" not in request.headers
        ):
            request.headers.__dict__["_list"].append(
                (b"authorization", f"Bearer {token}".encode("latin-1"))
            )
        return await call_next(request)
