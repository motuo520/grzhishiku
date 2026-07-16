import importlib.util
import json
import logging
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import FastAPI
from mcp.server.fastmcp import FastMCP

from app.models.base import User
from app.plugins.base import BasePlugin, PluginManifest

logger = logging.getLogger(__name__)

BUILTIN_PLUGINS_DIR = Path(__file__).parent / "builtin"
USER_PLUGINS_DIR = Path(__file__).parent.parent.parent / "plugins"


class PluginManager:
    """Discovers, loads and manages plugins from filesystem and builtins.

    Enable/disable state is stored per-user in `user.settings.plugins`.
    Routes/MCP tools are registered globally; endpoints/tools check user state.
    """

    def __init__(self):
        self.plugins: Dict[str, BasePlugin] = {}
        self._manifests: Dict[str, PluginManifest] = {}
        self._mcp: Optional[FastMCP] = None
        self._app: Optional[FastAPI] = None

    def discover(self) -> List[PluginManifest]:
        """Scan builtin and user plugin directories and return manifests."""
        manifests: List[PluginManifest] = []
        for root in (BUILTIN_PLUGINS_DIR, USER_PLUGINS_DIR):
            if not root.exists():
                continue
            for manifest_path in root.rglob("manifest.json"):
                try:
                    data = json.loads(manifest_path.read_text(encoding="utf-8"))
                    data["type"] = "builtin" if root == BUILTIN_PLUGINS_DIR else "local"
                    manifest = PluginManifest(**data)
                    manifest._manifest_path = manifest_path  # type: ignore
                    manifests.append(manifest)
                except Exception as e:
                    logger.warning("Failed to load plugin manifest %s: %s", manifest_path, e)
        return manifests

    def load_plugin(self, manifest: PluginManifest) -> Optional[BasePlugin]:
        """Load a plugin class from its manifest entrypoint."""
        manifest_path = getattr(manifest, "_manifest_path", None)
        if not manifest_path:
            return None
        plugin_dir = manifest_path.parent
        module_name = manifest.entrypoint.split(":")[0] if ":" in manifest.entrypoint else manifest.entrypoint
        class_name = manifest.entrypoint.split(":")[1] if ":" in manifest.entrypoint else "Plugin"
        module_file = plugin_dir / f"{module_name}.py"
        if not module_file.exists():
            logger.warning("Plugin module not found: %s", module_file)
            return None
        try:
            spec = importlib.util.spec_from_file_location(f"plugin_{manifest.id}", module_file)
            if not spec or not spec.loader:
                return None
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            plugin_class = getattr(module, class_name, None)
            if plugin_class is None or not issubclass(plugin_class, BasePlugin):
                logger.warning("Plugin %s does not expose a valid BasePlugin subclass", manifest.id)
                return None
            return plugin_class(manifest=manifest, config={})
        except Exception as e:
            logger.exception("Failed to load plugin %s: %s", manifest.id, e)
            return None

    def load_all(self) -> None:
        """Discover and instantiate all plugins."""
        self.plugins.clear()
        self._manifests.clear()
        for manifest in self.discover():
            plugin = self.load_plugin(manifest)
            if plugin:
                self.plugins[manifest.id] = plugin
                self._manifests[manifest.id] = manifest
                logger.info("Loaded plugin: %s v%s", manifest.id, manifest.version)

    def initialize(self, app: FastAPI, mcp: FastMCP) -> None:
        """Initialize enabled plugins: routers, MCP tools, lifecycle."""
        self._app = app
        self._mcp = mcp
        for plugin in self.plugins.values():
            try:
                plugin.initialize()
                for router in plugin.get_routers():
                    app.include_router(
                        router,
                        prefix=f"/api/v1/plugins/{plugin.manifest.id}",
                        tags=[f"Plugin: {plugin.manifest.name}"],
                    )
                plugin.register_mcp_tools(mcp)
                logger.info("Initialized plugin: %s", plugin.manifest.id)
            except Exception as e:
                logger.exception("Failed to initialize plugin %s: %s", plugin.manifest.id, e)

    # ---- user-level enablement / config ----

    def _user_plugins_state(self, user: User) -> dict:
        try:
            settings_data = json.loads(user.settings or "{}")
        except json.JSONDecodeError:
            settings_data = {}
        return settings_data.get("plugins") or {}

    def _save_user_plugins_state(self, user: User, state: dict, db) -> None:
        try:
            settings_data = json.loads(user.settings or "{}")
        except json.JSONDecodeError:
            settings_data = {}
        settings_data["plugins"] = state
        user.settings = json.dumps(settings_data, ensure_ascii=False)
        db.commit()
        db.refresh(user)

    def is_enabled(self, user: User, plugin_id: str) -> bool:
        state = self._user_plugins_state(user)
        enabled = state.get("enabled")
        if isinstance(enabled, list):
            return plugin_id in enabled
        disabled = state.get("disabled") or []
        if plugin_id in disabled:
            return False
        manifest = self._manifests.get(plugin_id)
        return manifest.enabled_default if manifest else False

    def set_enabled(self, user: User, plugin_id: str, enabled: bool, db) -> None:
        state = self._user_plugins_state(user)
        enabled_list = list(state.get("enabled") or [])
        disabled_list = list(state.get("disabled") or [])
        if enabled:
            if plugin_id not in enabled_list:
                enabled_list.append(plugin_id)
            if plugin_id in disabled_list:
                disabled_list.remove(plugin_id)
        else:
            if plugin_id in enabled_list:
                enabled_list.remove(plugin_id)
            if plugin_id not in disabled_list:
                disabled_list.append(plugin_id)
        state["enabled"] = enabled_list
        state["disabled"] = disabled_list
        self._save_user_plugins_state(user, state, db)
        plugin = self.plugins.get(plugin_id)
        if plugin:
            try:
                if enabled:
                    plugin.on_enable(user.id)
                else:
                    plugin.on_disable(user.id)
            except Exception:
                logger.exception("Plugin lifecycle hook failed for %s", plugin_id)

    def get_config(self, user: User, plugin_id: str) -> dict:
        state = self._user_plugins_state(user)
        return (state.get("configs") or {}).get(plugin_id) or {}

    def set_config(self, user: User, plugin_id: str, config: dict, db) -> None:
        state = self._user_plugins_state(user)
        configs = state.get("configs") or {}
        configs[plugin_id] = config
        state["configs"] = configs
        plugin = self.plugins.get(plugin_id)
        if plugin:
            plugin.config = config
        self._save_user_plugins_state(user, state, db)

    async def run_sync_for_user(self, user: User, plugin_id: str, db) -> dict:
        """Run a plugin's background sync logic for a specific user."""
        plugin = self.plugins.get(plugin_id)
        if not plugin:
            raise ValueError("Plugin not found")
        if not self.is_enabled(user, plugin_id):
            raise ValueError("Plugin is not enabled")
        return await plugin.run_sync(user, db)

    def get_auto_sync_config(self, user: User, plugin_id: str) -> dict:
        """Return the auto-sync configuration for a plugin."""
        cfg = self.get_config(user, plugin_id)
        return cfg.get("auto_sync") or {"enabled": False, "interval_minutes": 60}

    def set_auto_sync_config(self, user: User, plugin_id: str, auto_sync: dict, db) -> dict:
        """Persist auto-sync configuration nested inside the plugin config."""
        cfg = self.get_config(user, plugin_id)
        cfg["auto_sync"] = auto_sync
        self.set_config(user, plugin_id, cfg, db)
        return auto_sync

    def list_for_user(self, user: User) -> List[dict]:
        """Return all discovered plugins merged with user state."""
        result = []
        for plugin in self.plugins.values():
            manifest = plugin.manifest
            result.append({
                "id": manifest.id,
                "name": manifest.name,
                "version": manifest.version,
                "description": manifest.description,
                "type": manifest.type,
                "enabled": self.is_enabled(user, manifest.id),
                "config": self.get_config(user, manifest.id),
                "config_schema": plugin.get_config_schema(),
            })
        return result


plugin_manager = PluginManager()
