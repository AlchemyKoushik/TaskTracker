from collections import defaultdict
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from tasktracker import models
from tasktracker.timeutil import as_utc, report_window, utc_now
from tasktracker.settings import get_settings


def _workday_cutoff(workday: models.Workday) -> datetime:
    zone = ZoneInfo(workday.timezone)
    return datetime.combine(workday.work_date + timedelta(days=1), time(5, 0), tzinfo=zone).astimezone(utc_now().tzinfo)


def build_report(session: Session, start_date: date, end_date: date, period: str = "custom") -> dict:
    if end_date < start_date:
        raise ValueError("end_date must be on or after start_date")
    now = utc_now()
    segments = session.execute(
        select(models.ActivitySegment, models.TimeEntry, models.Task, models.Category, models.Workday)
        .join(models.TimeEntry, models.ActivitySegment.entry_id == models.TimeEntry.id)
        .join(models.Workday, models.TimeEntry.workday_id == models.Workday.id)
        .join(models.Task, models.TimeEntry.task_id == models.Task.id)
        .join(models.Category, models.Task.category_id == models.Category.id)
        .where(
            models.Workday.work_date.between(start_date, end_date),
            models.ActivitySegment.ended_at.is_not(None),
        )
        .order_by(models.Workday.work_date, models.ActivitySegment.started_at)
    ).all()
    open_workdays = int(session.scalar(
        select(func.count()).select_from(models.Workday).where(
            models.Workday.work_date.between(start_date, end_date),
            models.Workday.ended_at.is_(None),
        )
    ) or 0)
    open_segments = int(session.scalar(
        select(func.count())
        .select_from(models.ActivitySegment)
        .join(models.TimeEntry, models.ActivitySegment.entry_id == models.TimeEntry.id)
        .join(models.Workday, models.TimeEntry.workday_id == models.Workday.id)
        .where(models.Workday.work_date.between(start_date, end_date), models.ActivitySegment.ended_at.is_(None))
    ) or 0)

    categories: dict[str, dict] = {}
    daily = defaultdict(lambda: {"active_seconds": 0, "idle_seconds": 0, "paused_seconds": 0})
    task_ids = set()
    workday_ids = set()
    entry_ids = set()
    totals = {"active_seconds": 0, "idle_seconds": 0, "paused_seconds": 0}
    timeline = []
    for segment, entry, task, category, workday in segments:
        seg_start = as_utc(segment.started_at)
        cap = as_utc(workday.ended_at) if workday.ended_at else _workday_cutoff(workday)
        seg_end = min(as_utc(segment.ended_at) if segment.ended_at else now, cap)
        if seg_end <= seg_start:
            continue
        kind = segment.kind
        key = f"{kind}_seconds"
        bucket = categories.setdefault(category.id, {
            "id": category.id, "name": category.name, "active_seconds": 0,
            "idle_seconds": 0, "paused_seconds": 0, "tasks": {},
        })
        task_bucket = bucket["tasks"].setdefault(task.id, {
            "id": task.id, "name": task.name, "active_seconds": 0,
            "idle_seconds": 0, "paused_seconds": 0,
        })
        seconds = max(0, int((seg_end - seg_start).total_seconds()))
        bucket[key] += seconds
        task_bucket[key] += seconds
        totals[key] += seconds
        daily[workday.work_date.isoformat()][key] += seconds
        if kind in {"active", "idle"}:
            task_ids.add(task.id)
            workday_ids.add(entry.workday_id)
            entry_ids.add(entry.id)
        timeline.append({
            "entry_id": entry.id, "task_id": task.id, "task_name": task.name,
            "category_id": category.id, "category_name": category.name,
            "kind": kind, "started_at": seg_start.isoformat(), "ended_at": seg_end.isoformat(),
            "duration_seconds": seconds,
        })

    category_values = []
    for item in categories.values():
        item["tasks"] = sorted(item["tasks"].values(), key=lambda row: (-row["active_seconds"], row["name"].casefold()))
        category_values.append(item)
    category_values.sort(key=lambda row: (-row["active_seconds"], row["name"].casefold()))
    return {
        "period": period,
        "range": {"start_date": start_date.isoformat(), "end_date": end_date.isoformat(), "timezone": get_settings().app_timezone},
        "generated_at": now.isoformat(),
        "is_final": open_workdays == 0 and open_segments == 0,
        "completeness": {"open_workdays": open_workdays, "open_segments": open_segments},
        "summary": {
            **totals,
            "task_count": len(task_ids),
            "category_count": len({row["id"] for row in category_values if row["active_seconds"] or row["idle_seconds"]}),
            "workday_count": len(workday_ids),
            "time_entry_count": len(entry_ids),
        },
        "categories": category_values,
        "daily": [{"date": day, **daily[day]} for day in sorted(daily)],
        "timeline": timeline,
    }


def report_for_period(session: Session, period: str) -> dict:
    start_date, end_date = report_window(period)
    return build_report(session, start_date, end_date, period)
