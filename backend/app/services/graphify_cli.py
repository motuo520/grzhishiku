"""graphify CLI 包装入口（源码运行时的子进程调用目标）。

graphify_service._run_cli 在源码模式下以绝对路径调本脚本（子进程 cwd 是临时构建
目录，app 包不在 sys.path，故先自助引导路径），打完语言补丁后委托官方 CLI。

frozen 模式不走这里（desktop_entry 的 `-m graphify` 转发分支自行打补丁）。
升级 graphifyy 时复查，详见 graphify_prompt_patch.py 头注释。
"""
import sys
from pathlib import Path

# 本文件位于 backend/app/services/，backend 根目录上 sys.path 后才能 import app
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from app.services.graphify_prompt_patch import apply  # noqa: E402

apply()

from graphify.__main__ import main  # noqa: E402

if __name__ == "__main__":
    main()
