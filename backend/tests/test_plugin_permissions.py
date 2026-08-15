"""插件权限声明体系回归（BUG-M21，开源精简版适配）。

主仓 test_plugin_install.py 里基于 install-from-url 的两条用例未移植：
开源版无 URL 安装端点（插件安装通道已裁剪）。
"""
import logging

import pytest

from app.plugins.base import KNOWN_PERMISSIONS, PluginManifest
from app.plugins.manager import plugin_manager

GOOD_MANIFEST = {
    "id": "hello-world",
    "name": "Hello World",
    "version": "0.1.0",
    "description": "test plugin",
    "type": "local",
    "entrypoint": "plugin:HelloPlugin",
}


def test_manifest_permissions_parsed():
    manifest = PluginManifest(
        **{**GOOD_MANIFEST, "permissions": ["network.outbound", "storage.write"]}
    )
    assert manifest.permissions == ["network.outbound", "storage.write"]


def test_manifest_permissions_default_empty_and_warns(caplog):
    with caplog.at_level(logging.WARNING, logger="app.plugins.base"):
        manifest = PluginManifest(**GOOD_MANIFEST)
    assert manifest.permissions == []
    assert any("未声明 permissions" in r.message for r in caplog.records)


def test_manifest_unknown_permission_accepted_but_warns(caplog):
    with caplog.at_level(logging.WARNING, logger="app.plugins.base"):
        manifest = PluginManifest(
            **{**GOOD_MANIFEST, "permissions": ["network.outbound", "future.perm"]}
        )
    # 防君子口径：未知权限不拒绝（前向兼容），仅告警
    assert manifest.permissions == ["network.outbound", "future.perm"]
    assert any("未知权限" in r.message for r in caplog.records)


def test_known_permissions_enum_is_documented():
    # 枚举口径与 PERMISSIONS.md 保持同步的锚点
    assert {
        "files.read", "files.write", "network.outbound",
        "llm.call", "storage.read", "storage.write", "mcp.expose",
    } == KNOWN_PERMISSIONS


def test_builtin_manifests_declare_permissions():
    manifests = plugin_manager.discover()
    builtins = [m for m in manifests if m.type == "builtin"]
    assert builtins, "应至少发现一个内置插件"
    for m in builtins:
        assert m.permissions, f"内置插件 {m.id} 应声明 permissions"
        assert all(p in KNOWN_PERMISSIONS for p in m.permissions)


def test_list_and_enable_endpoints_carry_permissions(client, auth_headers):
    listed = client.get("/api/v1/plugins", headers=auth_headers)
    assert listed.status_code == 200, listed.text
    entry = next(p for p in listed.json() if p["id"] == "notion-import")
    assert entry["permissions"] == ["network.outbound", "storage.write"]

    enabled = client.post(
        "/api/v1/plugins/notion-import/enable",
        json={"enabled": True},
        headers=auth_headers,
    )
    assert enabled.status_code == 200, enabled.text
    assert enabled.json()["permissions"] == ["network.outbound", "storage.write"]
