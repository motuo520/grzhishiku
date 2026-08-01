# syntax=docker/dockerfile:1
#
# npm registry 可通过 build-arg 覆盖（默认使用官方源）：
#   国内用户加速示例：
#   docker build --build-arg NPM_REGISTRY=https://registry.npmmirror.com -t psb-frontend ./frontend

# Stage 1: Builder
FROM node:20-alpine AS builder

# NPM_REGISTRY 为空则使用 npm 官方源
ARG NPM_REGISTRY=""

WORKDIR /app

COPY package*.json ./
RUN if [ -n "$NPM_REGISTRY" ]; then npm config set registry "$NPM_REGISTRY"; fi && npm ci

COPY . .
RUN npm run build

# Stage 2: Nginx runner
FROM nginx:alpine AS runner

# Copy built assets
COPY --from=builder /app/dist /usr/share/nginx/html

# Copy custom nginx config
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --quiet --tries=1 --spider http://localhost/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
