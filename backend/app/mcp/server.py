from fastapi import FastAPI
from mcp.server.fastmcp import FastMCP

# Shared FastMCP instance used by the core system and all plugins.
mcp = FastMCP(
    "personal-second-brain",
    instructions=(
        "You are an agent connected to Wenmo, a local-first AI knowledge base. "
        "You can search knowledge, create notes and knowledge units, "
        "and inspect the cognitive production pipeline. "
        "Always ask for user_id when a tool requires it."
    ),
)


def mount_mcp(app: FastAPI) -> None:
    """Mount the MCP SSE server under /api/v1/mcp."""
    sse_app = mcp.sse_app()
    app.mount("/api/v1/mcp", sse_app)
