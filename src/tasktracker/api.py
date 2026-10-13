import asyncio
import hashlib
import hmac
import logging
import secrets
from contextlib import asynccontextmanager
from datetime import date, datetime
from pathlib import Path
from typing import Iterator
from uuid import uuid4

from fastapi import Depends, FastAPI, Header, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from sqlalchemy import Date as SqlDate, DateTime as SqlDateTime, func, or_, select
from sqlalchemy.orm import Session, joinedload

from tasktracker import models
from tasktracker.activity import seconds_since_last_input
from tasktracker.db import SessionLocal, initialize_database
from tasktracker.reporting import build_report, report_for_period
from tasktracker.repository import RECORD_MODELS
from tasktracker.schemas import CategoryCreate, PublishReportRequest, SettingsPatch, StartTaskRequest, SyncPushRequest, TaskCreate
from tasktracker.settings import get_settings
from tasktracker.sync import sync_loop, sync_pending
from tasktracker.timeutil import as_utc, utc_now
from tasktracker import tracking

settings = get_settings()
stop_background = asyncio.Event()
logger = logging.getLogger("tasktracker")


def db_session() -> Iterator[Session]:
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


def _iso(value: datetime | None) -> str | None:
    return as_utc(value).isoformat() if value else None


def require_mode(required: str) -> None:
    if get_settings().app_mode != required:
        raise HTTPException(status_code=404, detail="Endpoint not available in this runtime mode")


def require_token(authorization: str | None, expected: str | None, label: str) -> None:
    if not expected:
        raise HTTPException(status_code=503, detail=f"{label} is not configured")
    scheme, _, supplied = (authorization or "").partition(" ")
    if scheme.casefold() != "bearer" or not secrets.compare_digest(supplied, expected):
        raise HTTPException(status_code=401, detail="Invalid bearer token")


def report_auth(authorization: str | None = Header(default=None)) -> None:
    require_mode("server")
    require_token(authorization, get_settings().report_api_token, "REPORT_API_TOKEN")


def entry_view(session: Session, entry: models.TimeEntry | None) -> dict | None:
    if not entry:
        return None
    task = session.scalar(select(models.Task).options(joinedload(models.Task.category)).where(models.Task.id == entry.task_id))
    day = session.get(models.Workday, entry.workday_id)
    segment = tracking.open_segment(session, entry.id)
    active_seconds, idle_seconds, paused_seconds = entry.active_seconds, entry.idle_seconds, entry.paused_seconds
    segment_value = None
    if segment:
        segment_end = utc_now()
        if day:
            from tasktracker.tracking import _workday_deadline

            segment_end = min(segment_end, _workday_deadline(day))
        elapsed = max(0, int((as_utc(segment_end) - as_utc(segment.started_at)).total_seconds()))
        if segment.kind == "active":
            active_seconds += elapsed
        elif segment.kind == "idle":
            idle_seconds += elapsed
        elif segment.kind == "paused":
            paused_seconds += elapsed
        segment_value = {"kind": segment.kind, "started_at": _iso(segment.started_at), "elapsed_seconds": elapsed}
    return {
        "id": entry.id,
        "state": entry.state,
        "started_at": _iso(entry.started_at),
        "ended_at": _iso(entry.ended_at),
        "active_seconds": active_seconds,
        "idle_seconds": idle_seconds,
        "paused_seconds": paused_seconds,
        "close_reason": entry.close_reason,
        "current_segment": segment_value,
        "task": {
            "id": task.id, "name": task.name,
            "category": {"id": task.category.id, "name": task.category.name, "color": task.category.color},
        } if task else None,
        "workday": {"id": day.id, "work_date": day.work_date.isoformat(), "timezone": day.timezone} if day else None,
    }


async def activity_loop(stop: asyncio.Event) -> None:
    while not stop.is_set():
        session = SessionLocal()
        try:
            tracking.handle_runtime_gap(session)
            tracking.process_activity(session, seconds_since_last_input())
            state = session.get(models.RuntimeState, "last_heartbeat")
            last = datetime.fromisoformat(state.value) if state else None
            now = utc_now()
            if not last or (now - last).total_seconds() >= get_settings().heartbeat_seconds:
                tracking.heartbeat(session, now)
        except Exception:
            session.rollback()
            logger.exception("Activity monitor iteration failed")
        finally:
            session.close()
        try:
            await asyncio.wait_for(stop.wait(), timeout=max(1, get_settings().activity_poll_seconds))
        except TimeoutError:
            pass


@asynccontextmanager
async def lifespan(_app: FastAPI):
    initialize_database()
    tasks = []
    if get_settings().app_mode == "local":
        with SessionLocal() as session:
            tracking.recover_after_restart(session)
        stop_background.clear()
        tasks.append(asyncio.create_task(activity_loop(stop_background)))
        tasks.append(asyncio.create_task(sync_loop(stop_background)))
    yield
    stop_background.set()
    if tasks:
        await asyncio.gather(*tasks, return_exceptions=True)


app = FastAPI(title="TaskTracker API", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_methods=["GET", "POST", "PATCH", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)


@app.exception_handler(tracking.DomainError)
async def domain_error_handler(_request, exc: tracking.DomainError):
    return JSONResponse(status_code=exc.status_code, content={"error": exc.code, "message": exc.message})


@app.get("/health")
def health():
    return {"status": "ok", "mode": get_settings().app_mode, "version": app.version}


@app.get("/api/v1/bootstrap")
def bootstrap(session: Session = Depends(db_session)):
    require_mode("local")
    categories = session.scalars(select(models.Category).where(models.Category.archived.is_(False)).order_by(models.Category.name)).all()
    tasks = session.scalars(select(models.Task).options(joinedload(models.Task.category)).where(models.Task.archived.is_(False)).order_by(models.Task.name)).all()
    day = tracking.get_open_workday(session)
    current = tracking.get_current_entry(session)
    return {
        "api_version": "v1",
        "timezone": get_settings().app_timezone,
        "settings": {"idle_threshold_seconds": _idle_threshold(session), "cutoff_local_time": "05:00"},
        "current_workday": {"id": day.id, "work_date": day.work_date.isoformat(), "started_at": _iso(day.started_at)} if day else None,
        "current_entry": entry_view(session, current),
        "categories": [_category_view(row) for row in categories],
        "tasks": [_task_view(row) for row in tasks],
    }


def _category_view(row: models.Category) -> dict:
    return {"id": row.id, "name": row.name, "color": row.color, "created_at": _iso(row.created_at), "archived": row.archived}


def _task_view(row: models.Task) -> dict:
    return {
        "id": row.id, "name": row.name, "category_id": row.category_id,
        "category": {"id": row.category.id, "name": row.category.name, "color": row.category.color},
        "notes": row.notes, "created_at": _iso(row.created_at),
        "updated_at": _iso(row.updated_at), "archived": row.archived,
    }


def _idle_threshold(session: Session) -> int:
    row = session.get(models.RuntimeState, "idle_threshold_seconds")
    return int(row.value) if row else get_settings().idle_threshold_seconds


@app.get("/api/v1/categories")
def list_categories(session: Session = Depends(db_session)):
    require_mode("local")
    rows = session.scalars(select(models.Category).where(models.Category.archived.is_(False)).order_by(models.Category.name)).all()
    return {"items": [_category_view(row) for row in rows]}


@app.post("/api/v1/categories", status_code=201)
def create_category(payload: CategoryCreate, session: Session = Depends(db_session)):
    require_mode("local")
    now = utc_now()
    existing = session.scalar(select(models.Category).where(func.lower(models.Category.name) == payload.name.strip().lower()))
    if existing:
        raise HTTPException(status_code=409, detail={"error": "category_exists", "id": existing.id, "message": "That category already exists."})
    row = models.Category(id=str(uuid4()), name=payload.name.strip(), color=payload.color, created_at=now, updated_at=now, archived=False)
    session.add(row)
    session.flush()
    from tasktracker.repository import enqueue, serialize_record
    enqueue(session, "category", row.id, serialize_record(row))
    session.commit()
    return _category_view(row)


@app.get("/api/v1/tasks")
def search_tasks(q: str = Query(default="", max_length=240), limit: int = Query(default=30, ge=1, le=100), session: Session = Depends(db_session)):
    require_mode("local")
    stmt = select(models.Task).options(joinedload(models.Task.category)).where(models.Task.archived.is_(False))
    if q.strip():
        pattern = f"%{q.strip()}%"
        stmt = stmt.join(models.Category, models.Task.category_id == models.Category.id).where(or_(models.Task.name.ilike(pattern), models.Category.name.ilike(pattern)))
    rows = session.scalars(stmt.order_by(models.Task.updated_at.desc(), models.Task.name).limit(limit)).unique().all()
    return {"items": [_task_view(row) for row in rows]}


@app.post("/api/v1/tasks", status_code=201)
def create_task(payload: TaskCreate, session: Session = Depends(db_session)):
    require_mode("local")
    name = payload.name.strip()
    category = session.get(models.Category, payload.category_id)
    if not category or category.archived:
        raise HTTPException(status_code=404, detail={"error": "category_not_found", "message": "Choose an active category."})
    existing = session.scalar(select(models.Task).where(
        models.Task.category_id == category.id,
        models.Task.archived.is_(False),
        func.lower(models.Task.name) == name.lower(),
    ))
    if existing:
        raise HTTPException(status_code=409, detail={"error": "task_exists", "id": existing.id, "message": "A task with this name already exists in that category."})
    now = utc_now()
    row = models.Task(id=str(uuid4()), name=name, category_id=category.id, notes=payload.notes, created_at=now, updated_at=now, archived=False)
    session.add(row)
    session.flush()
    from tasktracker.repository import enqueue, serialize_record
    enqueue(session, "task", row.id, serialize_record(row))
    session.commit()
    session.refresh(row)
    return _task_view(row)


@app.get("/api/v1/current")
def current(session: Session = Depends(db_session)):
    require_mode("local")
    return {"current_entry": entry_view(session, tracking.get_current_entry(session)), "current_workday": _day_view(tracking.get_open_workday(session))}


def _day_view(day: models.Workday | None) -> dict | None:
    return {"id": day.id, "work_date": day.work_date.isoformat(), "started_at": _iso(day.started_at), "ended_at": _iso(day.ended_at), "close_reason": day.close_reason} if day else None


@app.post("/api/v1/tasks/start")
def start_task(payload: StartTaskRequest, session: Session = Depends(db_session)):
    require_mode("local")
    entry = tracking.start_task(session, payload.task_id)
    return {"current_entry": entry_view(session, entry)}


@app.post("/api/v1/tasks/wrap-up")
def wrap_task(session: Session = Depends(db_session)):
    require_mode("local")
    entry = tracking.wrap_task(session)
    return {"closed_entry": entry_view(session, entry), "current_entry": None}


@app.post("/api/v1/workday/wrap-up")
def wrap_day(session: Session = Depends(db_session)):
    require_mode("local")
    day = tracking.wrap_day(session)
    return {"workday": _day_view(day), "current_entry": None}


@app.post("/api/v1/tasks/pause")
def pause_task(session: Session = Depends(db_session)):
    require_mode("local")
    entry = tracking.pause_task(session)
    return {"current_entry": entry_view(session, entry)}


@app.post("/api/v1/tasks/resume")
def resume_task(session: Session = Depends(db_session)):
    require_mode("local")
    entry = tracking.resume_task(session)
    return {"current_entry": entry_view(session, entry)}


@app.get("/api/v1/workdays")
def list_workdays(start_date: date, end_date: date, session: Session = Depends(db_session)):
    require_mode("local")
    if end_date < start_date:
        raise HTTPException(status_code=400, detail="end_date must be on or after start_date")
    days = session.scalars(select(models.Workday).where(models.Workday.work_date.between(start_date, end_date)).order_by(models.Workday.work_date.desc())).all()
    result = []
    for day in days:
        entries = session.scalars(select(models.TimeEntry).where(models.TimeEntry.workday_id == day.id).order_by(models.TimeEntry.started_at)).all()
        result.append({"workday": _day_view(day), "totals": {
            "active_seconds": sum(row.active_seconds for row in entries),
            "idle_seconds": sum(row.idle_seconds for row in entries),
            "paused_seconds": sum(row.paused_seconds for row in entries),
        }, "entries": [entry_view(session, row) | {"active_seconds": row.active_seconds, "idle_seconds": row.idle_seconds, "paused_seconds": row.paused_seconds} for row in entries]})
    return {"items": result}


@app.get("/api/v1/reports/{period}")
def get_report(period: str, start_date: date | None = None, end_date: date | None = None, session: Session = Depends(db_session)):
    if get_settings().app_mode == "server":
        raise HTTPException(status_code=401, detail="Use bearer authentication for server reports")
    if period in {"previous_week", "previous_month"} and start_date is None and end_date is None:
        return report_for_period(session, period)
    if not start_date or not end_date:
        raise HTTPException(status_code=400, detail="Provide both start_date and end_date, or choose a standard period.")
    try:
        return build_report(session, start_date, end_date, "custom")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/api/v1/settings")
def get_user_settings(session: Session = Depends(db_session)):
    require_mode("local")
    return {"timezone": get_settings().app_timezone, "idle_threshold_seconds": _idle_threshold(session), "cutoff_local_time": "05:00"}


@app.patch("/api/v1/settings")
def patch_settings(payload: SettingsPatch, session: Session = Depends(db_session)):
    require_mode("local")
    if payload.idle_threshold_seconds is not None:
        row = session.get(models.RuntimeState, "idle_threshold_seconds")
        if not row:
            row = models.RuntimeState(key="idle_threshold_seconds", value=str(payload.idle_threshold_seconds), updated_at=utc_now())
            session.add(row)
        else:
            row.value = str(payload.idle_threshold_seconds)
            row.updated_at = utc_now()
        session.commit()
    return get_user_settings(session)


@app.get("/api/v1/sync/status")
def sync_status(session: Session = Depends(db_session)):
    require_mode("local")
    pending = session.scalars(select(models.OutboxRecord).where(models.OutboxRecord.synced_at.is_(None)).order_by(models.OutboxRecord.created_at.desc())).all()
    latest = session.scalar(select(models.OutboxRecord).order_by(models.OutboxRecord.created_at.desc()))
    return {
        "configured": bool(get_settings().sync_api_url and get_settings().sync_api_token),
        "pending_records": len(pending), "last_sync_at": _iso(latest.synced_at) if latest and latest.synced_at else None,
        "last_error": pending[0].last_error if pending else None,
    }


@app.post("/api/v1/sync/now")
async def sync_now():
    require_mode("local")
    return await sync_pending()


def _sync_auth(authorization: str | None) -> None:
    require_mode("server")
    require_token(authorization, get_settings().sync_api_token, "SYNC_API_TOKEN")


@app.post("/api/v1/sync/push")
def receive_sync(payload: SyncPushRequest, authorization: str | None = Header(default=None), session: Session = Depends(db_session)):
    _sync_auth(authorization)
    order = {"category": 0, "task": 1, "workday": 2, "time_entry": 3, "activity_segment": 4}
    records = sorted(payload.records, key=lambda row: order[row.type])
    try:
        for record in records:
            model = RECORD_MODELS[record.type]
            if record.data.get("id") != record.id:
                raise HTTPException(status_code=422, detail="Record id must match its envelope id")
            allowed = {column.name: column for column in model.__table__.columns}
            values = {key: value for key, value in record.data.items() if key in allowed}
            for key, value in list(values.items()):
                column_type = allowed[key].type
                if value is not None and isinstance(column_type, SqlDateTime):
                    values[key] = datetime.fromisoformat(value)
                elif value is not None and isinstance(column_type, SqlDate) and not isinstance(column_type, SqlDateTime):
                    values[key] = date.fromisoformat(value)
            session.merge(model(**values))
        session.flush()
        for published in session.scalars(select(models.PublishedReport)).all():
            published.payload = build_report(session, published.start_date, published.end_date, published.period)
        session.commit()
    except HTTPException:
        session.rollback()
        raise
    except Exception:
        session.rollback()
        raise HTTPException(status_code=503, detail="Could not apply sync batch; it is safe to retry.")
    return {"accepted": len(records), "idempotent": True}


@app.get("/api/v1/server/reports/{period}", dependencies=[Depends(report_auth)])
def server_report(period: str, session: Session = Depends(db_session)):
    if period not in {"previous_week", "previous_month"}:
        raise HTTPException(status_code=400, detail="period must be previous_week or previous_month")
    return report_for_period(session, period)


@app.post("/api/v1/server/reports/publish", dependencies=[Depends(report_auth)])
def publish_report(payload: PublishReportRequest, session: Session = Depends(db_session)):
    config = get_settings()
    if not config.public_report_signing_key or not config.public_dashboard_url:
        raise HTTPException(status_code=503, detail="Public report link hosting is not configured")
    report = report_for_period(session, payload.period)
    start = date.fromisoformat(report["range"]["start_date"])
    end = date.fromisoformat(report["range"]["end_date"])
    key = f"{payload.period}:{start.isoformat()}:{end.isoformat()}"
    digest = hmac.new(config.public_report_signing_key.encode(), key.encode(), "sha256").hexdigest()
    token_hash = hashlib.sha256(digest.encode()).hexdigest()
    row = session.scalar(select(models.PublishedReport).where(models.PublishedReport.report_key == key))
    if row is None:
        row = models.PublishedReport(id=str(uuid4()), report_key=key, period=payload.period, start_date=start, end_date=end, token_hash=token_hash, payload=report, published_at=utc_now())
        session.add(row)
    else:
        row.payload = report
        row.token_hash = token_hash
        row.published_at = utc_now()
    session.commit()
    return {
        "report_key": key,
        "period": payload.period,
        "range": report["range"],
        "url": f"{config.public_dashboard_url.rstrip('/')}/report/{digest}",
        "report": report,
    }


@app.get("/api/v1/public/reports/{token}")
def public_report(token: str, session: Session = Depends(db_session)):
    require_mode("server")
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    row = session.scalar(select(models.PublishedReport).where(models.PublishedReport.token_hash == token_hash))
    if not row:
        raise HTTPException(status_code=404, detail="Report link is invalid or has expired")
    return row.payload


def _frontend_directory() -> Path | None:
    configured = get_settings().web_dist_dir
    candidates = [
        Path(configured) if configured else None,
        Path(__file__).resolve().parents[2] / "ui" / "dist",
        Path("/app/ui-dist"),
    ]
    for candidate in candidates:
        if candidate and (candidate / "index.html").is_file():
            return candidate
    return None


@app.get("/{frontend_path:path}", include_in_schema=False)
def frontend(frontend_path: str):
    """Serve the compiled browser app and support BrowserRouter deep links."""
    directory = _frontend_directory()
    if directory is None:
        raise HTTPException(status_code=404, detail="Frontend bundle is not installed")
    requested = (directory / frontend_path).resolve()
    if requested.is_file() and directory.resolve() in requested.parents:
        return FileResponse(requested)
    return FileResponse(directory / "index.html")
