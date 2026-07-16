from fastapi import APIRouter

router = APIRouter()

@router.get("/dashboard")
async def get_dashboard_stats():
    return {"message": "Dashboard stats - TODO"}
