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

from starlette.datastructures import MutableHeaders
from starlette.middleware.base import BaseHTTPMiddleware

from app.core.config import settings

logger = logging.getLogger(__name__)

_READ_PREFIXES = ("/api/v1/",)

# 游客可写的演示开关（共享 demo 态，不写内容）：工作区切换 activate/deactivate。
# 幂等的状态翻转（成员校验在端点内照常执行），让游客能演示团队空间。
# 脑切换不在此列——脑侧是 GET 参数驱动的纯前端状态，游客走本地切换（各看各的）。
_GUEST_SWITCH_PATHS = (
    "/api/v1/tenants/deactivate",
)


def _guest_switch_allowed(path: str) -> bool:
    if path in _GUEST_SWITCH_PATHS:
        return True
    # POST /api/v1/tenants/{id}/activate
    return path.startswith("/api/v1/tenants/") and path.endswith("/activate")


def is_guest_demo_user(user) -> bool:
    """当前请求用户是否为游客演示账号（即注入的 guest token 对应的用户）。

    用于收窄 GET 写副作用：游客浏览触发的详情计数/自动建行等不计入、不落库。
    口径与 init_guest_demo_token 查号一致（settings.GUEST_DEMO_EMAIL 精确匹配）。
    """
    return bool(user is not None and getattr(user, "email", None) == settings.GUEST_DEMO_EMAIL)

# 已知攻击面（刻意保留，勿轻易收敛）：未登录 GET 命中整个 /api/v1/ 前缀都会
# 注入演示 token，即所有「按当前用户取数」的 GET 端点对匿名访客返回演示账号数据。
# 调查结论（官网 grzhishiku.com 游客自动进 demo 号依赖于此）：
# - 游客浏览会触发的 GET 面很宽且随页面演进（notes/knowledge/graph/capsules/tags/
#   billing 余额横幅等），前端散落 300+ 调用点，无法可靠枚举白名单；
# - 收敛白名单一旦漏掉某个端点，在线演示页面对应模块就会静默空态——演示是营销
#   门面，宁可保留宽面也不冒搞坏的风险。
# 安全不变量（运维侧必须保证）：
# - 演示账号只放可公开的演示数据，不得混入任何真实/敏感数据；
# - 写操作（POST/PUT/DELETE/PATCH）不受影响，仍需真实登录；
# - 自托管不播种演示账号时本功能自然关闭。


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
        # 演示 token 限 30 天：长运行时靠重启续期，避免 10 年长效 token 泄漏后长期可用。
        # 带上当前 token_version：演示账号改密/登出（token_version 递增）后旧缓存
        # token 会被 get_current_user 拒成静默 401；每次启动无条件重铸，
        # 过期/版本漂移随重启自愈。
        app.state.guest_demo_token = create_access_token(
            {"sub": user.id},
            expires_delta=timedelta(days=30),
            token_version=int(getattr(user, "token_version", None) or 0),
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
        headers = MutableHeaders(scope=request.scope)
        if (
            token
            and "authorization" not in headers
            and (
                (request.method == "GET" and request.url.path.startswith(_READ_PREFIXES))
                or (request.method == "POST" and _guest_switch_allowed(request.url.path))
            )
        ):
            headers["authorization"] = f"Bearer {token}"
        return await call_next(request)
