import asyncio
from datetime import datetime

import httpx
from sqlalchemy import case, func, select, update
from sqlalchemy.orm import Session

from tasktracker import models
from tasktracker.db import SessionLocal
from tasktracker.settings import get_settings
from tasktracker.timeutil import utc_now

ORDER = {"category": 0, "task": 1, "workday": 2, "time_entry": 3, "activity_segment": 4}


async def sync_pending() -> dict:
    settings = get_settings()
    if not settings.sync_api_url or not settings.sync_api_token:
        return {"sent": 0, "pending": _pending_count(), "configured": False}
    session = SessionLocal()
    try:
        records = session.scalars(
            select(models.OutboxRecord)
            .where(models.OutboxRecord.synced_at.is_(None))
            .order_by(case(ORDER, value=models.OutboxRecord.record_type, else_=9), models.OutboxRecord.created_at)
            .limit(500)
        ).all()
        if not records:
            return {"sent": 0, "pending": 0, "configured": True}
        batch = [{"type": row.record_type, "id": row.record_id, "data": row.payload} for row in records]
        revisions = [(row.id, row.revision) for row in records]
        try:
            async with httpx.AsyncClient(timeout=20) as client:
                response = await client.post(
                    f"{settings.sync_api_url.rstrip('/')}/api/v1/sync/push",
                    json={"records": batch},
                    headers={"Authorization": f"Bearer {settings.sync_api_token}"},
                )
                response.raise_for_status()
            sent_at = utc_now()
            for record_id, revision in revisions:
                session.execute(update(models.OutboxRecord).where(
                    models.OutboxRecord.id == record_id,
                    models.OutboxRecord.revision == revision,
                ).values(
                    synced_at=sent_at,
                    attempts=models.OutboxRecord.attempts + 1,
                    last_error=None,
                ))
            session.commit()
            return {"sent": len(records), "pending": _pending_count(session), "configured": True}
        except httpx.HTTPStatusError as exc:
            safe_error = f"Sync API returned HTTP {exc.response.status_code}"
            _record_failure(session, revisions, safe_error)
            session.commit()
            return {"sent": 0, "pending": _pending_count(session), "configured": True, "error": safe_error}
        except httpx.RequestError as exc:
            safe_error = f"Sync request failed ({type(exc).__name__})"
            _record_failure(session, revisions, safe_error)
            session.commit()
            return {"sent": 0, "pending": _pending_count(session), "configured": True, "error": safe_error}
        except Exception as exc:
            safe_error = f"Sync failed ({type(exc).__name__})"
            _record_failure(session, revisions, safe_error)
            session.commit()
            return {"sent": 0, "pending": _pending_count(session), "configured": True, "error": safe_error}
    finally:
        session.close()


def _pending_count(session: Session | None = None) -> int:
    own_session = session is None
    session = session or SessionLocal()
    try:
        return int(session.scalar(select(func.count()).select_from(models.OutboxRecord).where(models.OutboxRecord.synced_at.is_(None))) or 0)
    finally:
        if own_session:
            session.close()


def _record_failure(session: Session, revisions: list[tuple[str, int]], message: str) -> None:
    for record_id, revision in revisions:
        session.execute(update(models.OutboxRecord).where(
            models.OutboxRecord.id == record_id,
            models.OutboxRecord.revision == revision,
        ).values(
            attempts=models.OutboxRecord.attempts + 1,
            last_error=message,
        ))


async def sync_loop(stop: asyncio.Event) -> None:
    while not stop.is_set():
        await sync_pending()
        try:
            await asyncio.wait_for(stop.wait(), timeout=max(10, get_settings().sync_interval_seconds))
        except TimeoutError:
            pass
