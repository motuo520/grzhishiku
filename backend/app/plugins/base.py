from abc import ABC, abstractmethod
from typing import Any, List, Optional
from pydantic import BaseModel, Field
from fastapi import APIRouter


class PluginManifest(BaseModel):
    id: str = Field(..., description="Unique plugin identifier")
    name: str = Field(..., description="Display name")
    version: str = Field("0.1.0", description="Plugin version")
    description: str = Field("", description="Short description")
    type: str = Field("local", description="builtin or local")
    entrypoint: str = Field(..., description="Python module.class path, e.g. plugin.MyPlugin")
    enabled_default: bool = Field(True, description="Enabled by default for new users")
    config_schema: Optional[dict] = Field(None, description="JSON Schema for plugin config")


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
