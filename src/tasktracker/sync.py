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
FALLBACK_RECORD_LIMIT = 50
BATCH_SIZE = 50


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
        grouped = {}
        for row in records:
            grouped.setdefault(row.record_type, []).append(row)

        sent = 0
        errors = []
        async with httpx.AsyncClient(timeout=20) as client:
            for record_type in sorted(grouped, key=ORDER.get):
                type_records = grouped[record_type]
                for start in range(0, len(type_records), BATCH_SIZE):
                    result = await _sync_group(
                        client,
                        settings.sync_api_url,
                        settings.sync_api_token,
                        session,
                        type_records[start:start + BATCH_SIZE],
                    )
                    sent += result["sent"]
                    if result["error"]:
                        errors.append(result["error"])

        response = {"sent": sent, "pending": _pending_count(session), "configured": True}
        if errors:
            response["error"] = errors[0]
        return response
    finally:
        session.close()


async def _sync_group(client, api_url: str, api_token: str, session: Session, records: list[models.OutboxRecord]) -> dict:
    """Push one dependency level, falling back to individual records on batch conflicts."""
    result = await _push_records(client, api_url, api_token, records)
    if result["ok"]:
        _mark_synced(session, records)
        return {"sent": len(records), "error": None}

    if result["status"] not in {409, 422, 503} or len(records) > FALLBACK_RECORD_LIMIT:
        _record_failure(session, [(row.id, row.revision) for row in records], result["error"])
        session.commit()
        return {"sent": 0, "error": result["error"]}

    sent = 0
    errors = []
    for row in records:
        individual = await _push_records(client, api_url, api_token, [row])
        if individual["ok"]:
            _mark_synced(session, [row])
            sent += 1
        else:
            _record_failure(session, [(row.id, row.revision)], individual["error"])
            session.commit()
            errors.append(individual["error"])
    return {"sent": sent, "error": errors[0] if errors else None}


async def _push_records(client, api_url: str, api_token: str, records: list[models.OutboxRecord]) -> dict:
    batch = [{"type": row.record_type, "id": row.record_id, "data": row.payload} for row in records]
    try:
        response = await client.post(
            f"{api_url.rstrip('/')}/api/v1/sync/push",
            json={"records": batch},
            headers={"Authorization": f"Bearer {api_token}"},
        )
        response.raise_for_status()
        return {"ok": True, "status": response.status_code, "error": None}
    except httpx.HTTPStatusError as exc:
        return {"ok": False, "status": exc.response.status_code, "error": f"Sync API returned HTTP {exc.response.status_code}"}
    except httpx.RequestError as exc:
        return {"ok": False, "status": None, "error": f"Sync request failed ({type(exc).__name__})"}
    except Exception as exc:
        return {"ok": False, "status": None, "error": f"Sync failed ({type(exc).__name__})"}


def _mark_synced(session: Session, records: list[models.OutboxRecord]) -> None:
    sent_at = utc_now()
    for row in records:
        session.execute(update(models.OutboxRecord).where(
            models.OutboxRecord.id == row.id,
            models.OutboxRecord.revision == row.revision,
        ).values(
            synced_at=sent_at,
            attempts=models.OutboxRecord.attempts + 1,
            last_error=None,
        ))
    session.commit()


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
