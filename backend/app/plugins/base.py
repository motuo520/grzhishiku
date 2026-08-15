import logging
from abc import ABC, abstractmethod
from typing import Any, List, Optional
from pydantic import BaseModel, Field, model_validator
from fastapi import APIRouter

logger = logging.getLogger(__name__)

# 插件权限声明的枚举口径（详见 app/plugins/PERMISSIONS.md）。
# 「防君子不防小人」：只做声明与展示，不做运行时拦截；
# 未列入此集合的权限字符串不拒绝（前向兼容），仅在校验时警告日志。
KNOWN_PERMISSIONS = {
    "files.read",       # 读本地文件
    "files.write",      # 写本地文件
    "network.outbound", # 发起出站网络请求
    "llm.call",         # 调用 LLM
    "storage.read",     # 读应用数据（知识库/笔记等）
    "storage.write",    # 写应用数据
    "mcp.expose",       # 通过 MCP 向外部 Agent 暴露工具
}


class PluginManifest(BaseModel):
    id: str = Field(..., description="Unique plugin identifier")
    name: str = Field(..., description="Display name")
    version: str = Field("0.1.0", description="Plugin version")
    description: str = Field("", description="Short description")
    type: str = Field("local", description="builtin or local")
    entrypoint: str = Field(..., description="Python module.class path, e.g. plugin.MyPlugin")
    enabled_default: bool = Field(True, description="Enabled by default for new users")
    config_schema: Optional[dict] = Field(None, description="JSON Schema for plugin config")
    permissions: List[str] = Field(
        default_factory=list,
        description="Declared capability permissions, see KNOWN_PERMISSIONS / PERMISSIONS.md",
    )

    @model_validator(mode="before")
    @classmethod
    def _check_permissions(cls, data: Any) -> Any:
        # 权限边界声明：未声明默认空集合（警告日志）；声明了未知权限不拒绝，
        # 仅警告（防君子口径 + 前向兼容，新版本权限在旧后端上仍可安装）。
        if isinstance(data, dict):
            plugin_id = data.get("id", "<unknown>")
            declared = data.get("permissions")
            if declared is None:
                logger.warning(
                    "Plugin %s 未声明 permissions，按空集合处理（建议按 PERMISSIONS.md 补声明）",
                    plugin_id,
                )
            elif isinstance(declared, list):
                unknown = [p for p in declared if p not in KNOWN_PERMISSIONS]
                if unknown:
                    logger.warning(
                        "Plugin %s 声明了未知权限 %s（已知口径: %s）",
                        plugin_id, unknown, sorted(KNOWN_PERMISSIONS),
                    )
        return data


class BasePlugin(ABC):
    """Base class for all plugins.

    Subclasses must accept (manifest, config) in their constructor.
    They can optionally expose FastAPI routers, MCP tools, lifecycle hooks.
    """

    manifest: PluginManifest
    config: dict[str, Any]

    def __init__(self, manifest: PluginManifest, config: Optional[dict] = None):
        self.manifest = manifest
        self.config = config or {}

    def initialize(self) -> None:
        """Called once when the plugin is loaded at application startup."""
        pass

    def get_routers(self) -> List[APIRouter]:
        """Return FastAPI routers to be mounted under /api/v1/plugins/{plugin_id}."""
        return []

    def register_mcp_tools(self, mcp: Any) -> None:
        """Register MCP tools/resources/prompts on the shared FastMCP instance."""
        pass

    def get_config_schema(self) -> Optional[dict]:
        """Return JSON Schema for plugin configuration."""
        return self.manifest.config_schema

    def on_enable(self, user_id: str) -> None:
        """Called when a user enables this plugin."""
        pass

    def on_disable(self, user_id: str) -> None:
        """Called when a user disables this plugin."""
        pass

    async def run_sync(self, user: Any, db: Any) -> dict:
        """Optional sync entrypoint used by scheduled jobs and manual triggers.

        Plugins that support automatic background synchronization should implement
        this method and return a dict with at least ``created`` and ``skipped``.
        """
        raise NotImplementedError("This plugin does not support background sync")
