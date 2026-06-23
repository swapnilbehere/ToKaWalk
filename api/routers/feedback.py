from fastapi import APIRouter, HTTPException

from db.database import get_db
from models import FeedbackRequest

router = APIRouter()


@router.post("/feedback")
async def feedback(req: FeedbackRequest):
    async with get_db() as db:
        cursor = await db.execute(
            "UPDATE turns SET feedback = ? WHERE id = ?",
            (req.rating, req.turn_id),
        )
        await db.commit()
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Turn not found")
    return {"status": "ok"}
