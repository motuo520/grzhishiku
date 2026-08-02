# 镜像源可通过 build-arg 覆盖（默认使用官方源）：
#   国内用户加速示例：
#   docker build \
#     --build-arg APT_MIRROR=mirrors.aliyun.com \
#     --build-arg PIP_INDEX_URL=https://mirrors.aliyun.com/pypi/simple/ \
#     -t psb-backend ./backend
#   或在 compose 中：
#   docker compose build --build-arg APT_MIRROR=mirrors.aliyun.com \
#     --build-arg PIP_INDEX_URL=https://mirrors.aliyun.com/pypi/simple/
#
# 注意：不要加 `# syntax=docker/dockerfile:1` 指令——它会强制 buildkit
# 拉取外部 dockerfile 前端镜像，在无法访问 auth.docker.io 的网络下构建直接失败；
# 本文件只用基础特性，buildkit 内置前端即可。

# Stage 1: Builder
FROM python:3.11-slim AS builder

# APT_MIRROR 为空则使用 Debian 官方源；PIP_INDEX_URL 默认为 PyPI 官方源
ARG APT_MIRROR=""
ARG PIP_INDEX_URL=https://pypi.org/simple

WORKDIR /app

# Install build dependencies
RUN if [ -n "$APT_MIRROR" ]; then \
      sed -i "s|deb.debian.org|$APT_MIRROR|g" /etc/apt/sources.list.d/debian.sources; \
    fi \
    && apt-get update && apt-get install -y --no-install-recommends gcc && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir --user -i "$PIP_INDEX_URL" -r requirements.txt

# Stage 2: Runner
FROM python:3.11-slim AS runner

WORKDIR /app

# Copy installed packages from builder
COPY --from=builder /root/.local /root/.local

# Make sure scripts in .local are usable
ENV PATH=/root/.local/bin:$PATH \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# Create non-root user (optional, but kept root for volume permissions)
# RUN useradd -m appuser && chown -R appuser:appuser /app
# USER appuser

COPY app/ ./app/
COPY scripts/ ./scripts/

# Expose port
EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')" || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
