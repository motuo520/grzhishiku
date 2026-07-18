.PHONY: dev install frontend backend extension clean test

# Development commands
dev:
	@echo "Starting all services..."
	@start /B cmd /c "cd frontend && npm run dev"
	@start /B cmd /c "cd backend && uvicorn app.main:app --reload --port 8000"
	@echo "Frontend: http://localhost:3000"
	@echo "Backend: http://localhost:8000"
	@echo "Swagger: http://localhost:8000/docs"

# Install dependencies
install:
	cd frontend && npm install
	cd backend && pip install -r requirements.txt
	cd browser-extension && npm install

# Frontend commands
frontend:
	cd frontend && npm run dev

frontend-build:
	cd frontend && npm run build

# Backend commands
backend:
	cd backend && uvicorn app.main:app --reload --port 8000

backend-test:
	cd backend && pytest

# Extension commands
extension:
	cd browser-extension && npm run dev

extension-build:
	cd browser-extension && npm run build

extension-build-all:
	cd browser-extension && npm run build:chrome && npm run build:firefox

# Desktop commands
desktop:
	cd desktop && npm run dev

desktop-embedded:
	cd desktop && npm run dev:embedded

desktop-smoke:
	cd desktop && npm run smoke

desktop-icon:
	cd desktop && npm run icon

desktop-dist:
	cd desktop && npm run dist

# Database
db-migrate:
	cd backend && alembic upgrade head

db-revision:
	cd backend && alembic revision --autogenerate -m "$(msg)"

# Docker
docker-up:
	docker-compose up -d

docker-down:
	docker-compose down

docker-build:
	docker-compose build

# Testing
test:
	cd backend && pytest
	cd frontend && npm run typecheck

# 前端端到端测试（需先启动前后端服务）
test-e2e:
	cd frontend && npm run test:e2e

# Code quality
lint:
	cd frontend && npm run lint
	cd backend && ruff check app

format:
	cd backend && black app

# Clean
clean:
	cd frontend && rmdir /s /q node_modules dist
	cd backend && rmdir /s /q __pycache__ .pytest_cache
	cd browser-extension && rmdir /s /q node_modules dist
