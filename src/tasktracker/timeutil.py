from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from tasktracker.settings import get_settings


def utc_now() -> datetime:
    return datetime.now(UTC)


def as_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def local_now() -> datetime:
    return utc_now().astimezone(ZoneInfo(get_settings().app_timezone))


def cutoff_for(local_day: date) -> datetime:
    zone = ZoneInfo(get_settings().app_timezone)
    return datetime.combine(local_day, time(5, 0), tzinfo=zone).astimezone(UTC)


def workday_date(at: datetime) -> date:
    local = as_utc(at).astimezone(ZoneInfo(get_settings().app_timezone))
    return local.date() - timedelta(days=1) if local.hour < 5 else local.date()


def report_window(kind: str, now: datetime | None = None) -> tuple[date, date]:
    local = as_utc(now or utc_now()).astimezone(ZoneInfo(get_settings().app_timezone))
    today = local.date()
    if kind == "previous_week":
        this_monday = today - timedelta(days=today.weekday())
        return this_monday - timedelta(days=7), this_monday - timedelta(days=1)
    if kind == "previous_month":
        this_month = today.replace(day=1)
        last_day = this_month - timedelta(days=1)
        return last_day.replace(day=1), last_day
    raise ValueError("period must be previous_week or previous_month")
