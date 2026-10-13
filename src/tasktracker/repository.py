from datetime import datetime
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session

from tasktracker import models
from tasktracker.timeutil import as_utc, utc_now

RECORD_MODELS = {
    "category": models.Category,
    "task": models.Task,
    "workday": models.Workday,
    "time_entry": models.TimeEntry,
    "activity_segment": models.ActivitySegment,
}


def enqueue(session: Session, record_type: str, record_id: str, data: dict) -> None:
    row = session.scalar(select(models.OutboxRecord).where(
        models.OutboxRecord.record_type == record_type,
        models.OutboxRecord.record_id == record_id,
    ))
    if row is None:
        row = models.OutboxRecord(
            id=str(uuid4()), record_type=record_type, record_id=record_id,
            payload=data, created_at=utc_now(), attempts=0,
        )
        session.add(row)
    else:
        row.payload = data
        row.created_at = utc_now()
        row.revision += 1
        row.synced_at = None
        row.last_error = None


def serialize_record(row) -> dict:
    result = {}
    for column in row.__table__.columns:
        value = getattr(row, column.name)
        if isinstance(value, datetime):
            value = as_utc(value).isoformat()
        elif hasattr(value, "isoformat"):
            value = value.isoformat()
        result[column.name] = value
    return result
