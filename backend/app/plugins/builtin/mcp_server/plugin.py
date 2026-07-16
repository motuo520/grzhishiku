from app.mcp.tools import register_core_tools
from app.plugins.base import BasePlugin


class McpServerPlugin(BasePlugin):
    """Built-in plugin that contributes the core MCP toolset."""

    def register_mcp_tools(self, mcp) -> None:
        register_core_tools(mcp)

    def initialize(self) -> None:
        pass
