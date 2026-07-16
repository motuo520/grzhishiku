from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException as StarletteHTTPException
import traceback
import logging

logger = logging.getLogger("psb")

class PSBException(Exception):
    """Base exception for Personal Second Brain"""
    def __init__(self, message: str, status_code: int = 500, error_code: str = "INTERNAL_ERROR"):
        self.message = message
        self.status_code = status_code
        self.error_code = error_code
        super().__init__(self.message)

class AuthenticationError(PSBException):
    """Authentication failed"""
    def __init__(self, message: str = "Authentication failed"):
        super().__init__(message, status_code=401, error_code="AUTHENTICATION_ERROR")

class AuthorizationError(PSBException):
    """Not authorized"""
    def __init__(self, message: str = "Not authorized"):
        super().__init__(message, status_code=403, error_code="AUTHORIZATION_ERROR")

class ValidationError(PSBException):
    """Validation failed"""
    def __init__(self, message: str = "Validation failed"):
        super().__init__(message, status_code=400, error_code="VALIDATION_ERROR")

class NotFoundError(PSBException):
    """Resource not found"""
    def __init__(self, message: str = "Resource not found"):
        super().__init__(message, status_code=404, error_code="NOT_FOUND")

class ConflictError(PSBException):
    """Resource conflict"""
    def __init__(self, message: str = "Resource conflict"):
        super().__init__(message, status_code=409, error_code="CONFLICT")

def register_exception_handlers(app: FastAPI):
    """Register all exception handlers with the FastAPI app"""
    
    @app.exception_handler(PSBException)
    async def psb_exception_handler(request: Request, exc: PSBException):
        return JSONResponse(
            status_code=exc.status_code,
            content={
                "error": {
                    "code": exc.error_code,
                    "message": exc.message,
                    "status": exc.status_code,
                }
            }
        )
    
    @app.exception_handler(StarletteHTTPException)
    async def http_exception_handler(request: Request, exc: StarletteHTTPException):
        return JSONResponse(
            status_code=exc.status_code,
            content={
                "error": {
                    "code": f"HTTP_{exc.status_code}",
                    "message": exc.detail,
                    "status": exc.status_code,
                }
            }
        )
    
    @app.exception_handler(RequestValidationError)
    async def validation_exception_handler(request: Request, exc: RequestValidationError):
        errors = []
        for error in exc.errors():
            errors.append({
                "field": ".".join(str(loc) for loc in error["loc"]),
                "message": error["msg"],
                "type": error["type"],
            })
        return JSONResponse(
            status_code=422,
            content={
                "error": {
                    "code": "VALIDATION_ERROR",
                    "message": "Request validation failed",
                    "status": 422,
                    "details": errors,
                }
            }
        )
    
    @app.exception_handler(Exception)
    async def general_exception_handler(request: Request, exc: Exception):
        logger.error(f"Unhandled exception: {str(exc)}")
        logger.error(traceback.format_exc())
        return JSONResponse(
            status_code=500,
            content={
                "error": {
                    "code": "INTERNAL_ERROR",
                    "message": "An internal server error occurred",
                    "status": 500,
                }
            }
        )
