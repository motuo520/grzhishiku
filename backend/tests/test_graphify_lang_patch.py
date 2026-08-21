# -*- coding: utf-8 -*-
"""graphify 语言补丁回归：中文语料必须出中文标签的接线保障。

实证背景（08-20 双跑）：同一 4 篇中文笔记，未补丁 28 节点 0 中文 label，
补丁后 27/27 中文、边 17→21。补丁点升级 graphifyy 时必须复查。
"""
import subprocess
import sys
from pathlib import Path

from app.services import graphify_prompt_patch, graphify_service


class TestPromptPatch:
    def test_apply_appends_language_rule(self):
        import graphify.llm as llm
        original = llm._EXTRACTION_SYSTEM
        try:
            # 幂等：重复 apply 不重复追加
            graphify_prompt_patch.apply()
            graphify_prompt_patch.apply()
            assert llm._EXTRACTION_SYSTEM.count("LANGUAGE RULE") == 1
            assert "dominant language" in llm._EXTRACTION_SYSTEM
        finally:
            llm._EXTRACTION_SYSTEM = original

    def test_apply_without_graphify_is_noop(self, monkeypatch):
        # graphify 不在环境时静默跳过（纯 API 部署形态）
        monkeypatch.setitem(sys.modules, "graphify.llm", None)
        graphify_prompt_patch.apply()  # 不抛即过


class TestCliWiring:
    def test_source_mode_uses_wrapper(self):
        cmd = graphify_service._cli_cmd(["extract", "corpus"])
        # 测试环境非 frozen：必须走 wrapper 脚本而不是 -m graphify
        assert cmd[1].endswith("graphify_cli.py")
        assert Path(cmd[1]).exists()
        assert cmd[2:] == ["extract", "corpus"]

    def test_frozen_mode_keeps_dash_m(self, monkeypatch):
        monkeypatch.setattr(sys, "frozen", True, raising=False)
        cmd = graphify_service._cli_cmd(["extract", "corpus"])
        assert cmd[1:3] == ["-m", "graphify"]

    def test_wrapper_actually_patches_subprocess(self):
        # 真起子进程验证：wrapper 打完补丁再进官方 CLI（--version 即刻退出）
        wrapper = Path(graphify_service.__file__).resolve().parent / "graphify_cli.py"
        proc = subprocess.run(
            [sys.executable, str(wrapper), "--version"],
            capture_output=True, text=True, timeout=60,
        )
        assert proc.returncode == 0
        assert "graphify" in (proc.stdout + proc.stderr).lower()
