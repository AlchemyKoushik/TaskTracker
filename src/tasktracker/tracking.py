from datetime import date, datetime, timedelta
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from tasktracker import models
from tasktracker.repository import enqueue, serialize_record
from tasktracker.settings import get_settings
from tasktracker.timeutil import as_utc, cutoff_for, utc_now, workday_date


class DomainError(Exception):
    def __init__(self, code: str, message: str, status_code: int = 409):
        self.code = code
        self.message = message
        self.status_code = status_code
        super().__init__(message)


def get_open_workday(session: Session) -> models.Workday | None:
    return session.scalar(select(models.Workday).where(models.Workday.ended_at.is_(None)).order_by(models.Workday.started_at.desc()))


def get_current_entry(session: Session) -> models.TimeEntry | None:
    return session.scalar(
        select(models.TimeEntry).options(joinedload(models.TimeEntry.workday)).where(
            models.TimeEntry.ended_at.is_(None)
        ).order_by(models.TimeEntry.started_at.desc())
    )


def open_segment(session: Session, entry_id: str) -> models.ActivitySegment | None:
    return session.scalar(select(models.ActivitySegment).where(
        models.ActivitySegment.entry_id == entry_id,
        models.ActivitySegment.ended_at.is_(None),
    ).order_by(models.ActivitySegment.started_at.desc()))


def _queue(session: Session, record_type: str, row) -> None:
    enqueue(session, record_type, row.id, serialize_record(row))


def _new_segment(session: Session, entry: models.TimeEntry, kind: str, start: datetime) -> models.ActivitySegment:
    segment = models.ActivitySegment(id=str(uuid4()), entry_id=entry.id, kind=kind, started_at=as_utc(start), open_key=entry.id)
    session.add(segment)
    session.flush()
    return segment


def _close_segment(session: Session, entry: models.TimeEntry, end: datetime) -> None:
    segment = open_segment(session, entry.id)
    if segment is None:
        return
    stop = max(as_utc(end), as_utc(segment.started_at))
    segment.ended_at = stop
    segment.open_key = None
    seconds = max(0, int((stop - as_utc(segment.started_at)).total_seconds()))
    if segment.kind == "active":
        entry.active_seconds += seconds
    elif segment.kind == "idle":
        entry.idle_seconds += seconds
    elif segment.kind == "paused":
        entry.paused_seconds += seconds
    _queue(session, "activity_segment", segment)


def _close_entry(session: Session, entry: models.TimeEntry, end: datetime, reason: str) -> None:
    _close_segment(session, entry, end)
    entry.ended_at = max(as_utc(end), as_utc(entry.started_at))
    entry.open_key = None
    entry.state = "closed"
    entry.close_reason = reason
    _queue(session, "time_entry", entry)


def _close_workday(session: Session, day: models.Workday, end: datetime, reason: str) -> None:
    entry = get_current_entry(session)
    if entry and entry.workday_id == day.id:
        _close_entry(session, entry, end, reason)
    day.ended_at = max(as_utc(end), as_utc(day.started_at))
    day.open_key = None
    day.close_reason = reason
    _queue(session, "workday", day)


def _workday_deadline(day: models.Workday) -> datetime:
    # Workday label is the date after 05:00; it closes at 05:00 on the next date.
    return cutoff_for(day.work_date + timedelta(days=1))


def start_task(session: Session, task_id: str, at: datetime | None = None) -> models.TimeEntry:
    now = as_utc(at or utc_now())
    current = get_current_entry(session)
    if current:
        raise DomainError("task_already_running", "Wrap up or pause the current task before starting another.")
    task = session.get(models.Task, task_id)
    if not task or task.archived:
        raise DomainError("task_not_found", "Choose an existing, active task.", 404)
    task.updated_at = now
    _queue(session, "task", task)
    day = get_open_workday(session)
    if day is None:
        day = models.Workday(
            id=str(uuid4()), work_date=workday_date(now), timezone=get_settings().app_timezone,
            started_at=now, open_key="open",
        )
        session.add(day)
        session.flush()
        _queue(session, "workday", day)
    elif now >= _workday_deadline(day):
        _close_workday(session, day, _workday_deadline(day), "automatic_cutoff")
        session.flush()
        day = models.Workday(
            id=str(uuid4()), work_date=workday_date(now), timezone=get_settings().app_timezone,
            started_at=now, open_key="open",
        )
        session.add(day)
        session.flush()
        _queue(session, "workday", day)
    entry = models.TimeEntry(
        id=str(uuid4()), workday_id=day.id, task_id=task.id, started_at=now,
        state="running", active_seconds=0, idle_seconds=0, paused_seconds=0, open_key="open",
    )
    session.add(entry)
    session.flush()
    segment = _new_segment(session, entry, "active", now)
    _queue(session, "time_entry", entry)
    _queue(session, "activity_segment", segment)
    session.commit()
    return session.scalar(select(models.TimeEntry).options(joinedload(models.TimeEntry.workday)).where(models.TimeEntry.id == entry.id))


def wrap_task(session: Session, at: datetime | None = None, reason: str = "manual_task_wrap") -> models.TimeEntry:
    entry = get_current_entry(session)
    if not entry:
        raise DomainError("no_running_task", "There is no current task to wrap up.", 404)
    now = as_utc(at or utc_now())
    day = session.get(models.Workday, entry.workday_id)
    end = min(now, _workday_deadline(day)) if day else now
    _close_entry(session, entry, end, reason)
    if day and end >= _workday_deadline(day):
        day.ended_at = end
        day.open_key = None
        day.close_reason = "automatic_cutoff"
        _queue(session, "workday", day)
    session.commit()
    return entry


def wrap_day(session: Session, at: datetime | None = None, reason: str = "manual_day_wrap") -> models.Workday:
    day = get_open_workday(session)
    if not day:
        raise DomainError("no_open_workday", "There is no open workday to wrap up.", 404)
    now = as_utc(at or utc_now())
    if now >= _workday_deadline(day):
        now = _workday_deadline(day)
        reason = "automatic_cutoff"
    _close_workday(session, day, now, reason)
    session.commit()
    return day


def pause_task(session: Session, at: datetime | None = None) -> models.TimeEntry:
    entry = get_current_entry(session)
    if not entry:
        raise DomainError("no_running_task", "There is no current task to pause.", 404)
    now = as_utc(at or utc_now())
    day = session.get(models.Workday, entry.workday_id)
    if day and now >= _workday_deadline(day):
        _close_workday(session, day, _workday_deadline(day), "automatic_cutoff")
        session.commit()
        raise DomainError("workday_closed", "The workday reached its 5:00 AM cutoff.")
    segment = open_segment(session, entry.id)
    if segment and segment.kind == "paused":
        raise DomainError("task_already_paused", "The current task is already paused.")
    _close_segment(session, entry, now)
    paused = _new_segment(session, entry, "paused", now)
    entry.state = "paused"
    _queue(session, "activity_segment", paused)
    _queue(session, "time_entry", entry)
    session.commit()
    return entry


def resume_task(session: Session, at: datetime | None = None) -> models.TimeEntry:
    entry = get_current_entry(session)
    if not entry:
        raise DomainError("no_paused_task", "There is no paused task to resume.", 404)
    now = as_utc(at or utc_now())
    day = session.get(models.Workday, entry.workday_id)
    if day and now >= _workday_deadline(day):
        _close_workday(session, day, _workday_deadline(day), "automatic_cutoff")
        session.commit()
        raise DomainError("workday_closed", "The workday reached its 5:00 AM cutoff. Start a task to open the next workday.")
    segment = open_segment(session, entry.id)
    if not segment or segment.kind != "paused":
        raise DomainError("task_not_paused", "The current task is not paused.")
    _close_segment(session, entry, now)
    active = _new_segment(session, entry, "active", now)
    entry.state = "running"
    _queue(session, "activity_segment", active)
    _queue(session, "time_entry", entry)
    session.commit()
    return entry


def process_activity(session: Session, idle_age: float, at: datetime | None = None) -> None:
    now = as_utc(at or utc_now())
    day = get_open_workday(session)
    if day and now >= _workday_deadline(day):
        _close_workday(session, day, _workday_deadline(day), "automatic_cutoff")
        session.commit()
        return
    entry = get_current_entry(session)
    if not entry or entry.state == "paused":
        return
    segment = open_segment(session, entry.id)
    if not segment:
        return
    threshold_state = session.get(models.RuntimeState, "idle_threshold_seconds")
    threshold = int(threshold_state.value) if threshold_state else get_settings().idle_threshold_seconds
    if idle_age >= threshold and segment.kind == "active":
        idle_start = now - timedelta(seconds=max(0.0, idle_age - threshold))
        idle_start = max(as_utc(segment.started_at), idle_start)
        _close_segment(session, entry, idle_start)
        idle = _new_segment(session, entry, "idle", idle_start)
        entry.state = "idle"
        _queue(session, "activity_segment", idle)
        _queue(session, "time_entry", entry)
        session.commit()
    elif idle_age < threshold and segment.kind == "idle":
        input_at = now - timedelta(seconds=idle_age)
        active_start = max(as_utc(segment.started_at), input_at)
        _close_segment(session, entry, active_start)
        active = _new_segment(session, entry, "active", active_start)
        entry.state = "running"
        _queue(session, "activity_segment", active)
        _queue(session, "time_entry", entry)
        session.commit()


def heartbeat(session: Session, at: datetime | None = None) -> None:
    now = as_utc(at or utc_now())
    state = session.get(models.RuntimeState, "last_heartbeat")
    if state is None:
        state = models.RuntimeState(key="last_heartbeat", value=now.isoformat(), updated_at=now)
        session.add(state)
    else:
        state.value = now.isoformat()
        state.updated_at = now
    session.commit()


def handle_runtime_gap(session: Session, now: datetime | None = None) -> None:
    """Put a live task into paused state after sleep/suspend or a delayed service loop."""
    current = get_current_entry(session)
    if not current:
        return
    state = session.get(models.RuntimeState, "last_heartbeat")
    if not state:
        return
    previous = as_utc(datetime.fromisoformat(state.value))
    moment = as_utc(now or utc_now())
    if (moment - previous).total_seconds() <= max(15, get_settings().heartbeat_seconds * 3):
        return
    day = session.get(models.Workday, current.workday_id)
    stop = min(previous, _workday_deadline(day)) if day else previous
    if day and moment >= _workday_deadline(day):
        _close_entry(session, current, stop, "automatic_cutoff")
        day.ended_at = _workday_deadline(day)
        day.open_key = None
        day.close_reason = "automatic_cutoff"
        _queue(session, "workday", day)
        session.commit()
        return
    segment = open_segment(session, current.id)
    if segment and segment.kind != "paused":
        _close_segment(session, current, stop)
        paused = _new_segment(session, current, "paused", stop)
        current.state = "paused"
        _queue(session, "activity_segment", paused)
        _queue(session, "time_entry", current)
        session.commit()


def recover_after_restart(session: Session, now: datetime | None = None) -> None:
    """Close unobserved running time at the last heartbeat and leave the task paused."""
    current = get_current_entry(session)
    if not current:
        day = get_open_workday(session)
        if day and as_utc(now or utc_now()) >= _workday_deadline(day):
            _close_workday(session, day, _workday_deadline(day), "automatic_cutoff")
        heartbeat(session, now)
        return
    state = session.get(models.RuntimeState, "last_heartbeat")
    stop = as_utc(datetime.fromisoformat(state.value)) if state else as_utc(now or utc_now())
    day = session.get(models.Workday, current.workday_id)
    if day:
        stop = min(stop, _workday_deadline(day))
    segment = open_segment(session, current.id)
    if segment:
        stop = max(as_utc(segment.started_at), stop)
        _close_segment(session, current, stop)
        if day and stop < _workday_deadline(day) and (now is None or as_utc(now) < _workday_deadline(day)):
            paused = _new_segment(session, current, "paused", stop)
            current.state = "paused"
            _queue(session, "activity_segment", paused)
            _queue(session, "time_entry", current)
        else:
            _close_entry(session, current, stop, "automatic_cutoff")
            if day:
                day.ended_at = _workday_deadline(day)
                day.open_key = None
                day.close_reason = "automatic_cutoff"
                _queue(session, "workday", day)
    heartbeat(session, now)
