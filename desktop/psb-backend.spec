# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller spec：把 FastAPI 后端冻结为 psb-backend（onedir）。

构建（在 desktop/ 下）：
  ../backend/.venv/Scripts/python.exe -m PyInstaller psb-backend.spec --distpath backend-dist --workpath backend-build --noconfirm

注意：console=True 是刻意的——Electron 主进程用 windowsHide 隐藏控制台窗口，
保留可用的 stdout/stderr 便于日志管道；console=False 会让 sys.stdout 变 None。
"""
from PyInstaller.utils.hooks import collect_all, collect_submodules
import os
import sys

# desktop_entry.py 通过 uvicorn 字符串导入 app.main，静态分析抓不到；
# 先把 backend 根目录加入 sys.path，collect_submodules 才能找到 app 包
BACKEND_ROOT = os.path.abspath('../backend')
sys.path.insert(0, BACKEND_ROOT)

datas, binaries, hiddenimports = [], [], []

# graphifyy / mcp 含数据文件与动态导入，整体收集；
# 排除 mcp.cli（CLI 工具依赖 typer，运行时不需要）
for pkg in ('graphifyy', 'mcp'):
    d, b, h = collect_all(pkg, filter_submodules=lambda name: not name.startswith('mcp.cli'))
    datas += d
    binaries += b
    hiddenimports += h

# app 包全量子模块（路由在 import 时注册）
hiddenimports += collect_submodules('app')

a = Analysis(
    ['../backend/scripts/desktop_entry.py'],
    pathex=[BACKEND_ROOT],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        'chromadb', 'redis', 'onnxruntime',
        'pytest', '_pytest', 'pytest_asyncio', 'pytest_cov',
        'black', 'ruff',
    ],
    noarchive=False,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='psb-backend',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    name='psb-backend',
)
