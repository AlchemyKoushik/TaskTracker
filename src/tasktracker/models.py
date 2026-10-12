from datetime import date, datetime

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Integer, JSON, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from tasktracker.db import Base


class Category(Base):
    __tablename__ = "tt_categories"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    name: Mapped[str] = mapped_column(String(120), unique=True, index=True)
    color: Mapped[str] = mapped_column(String(24), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    archived: Mapped[bool] = mapped_column(Boolean, default=False)


class Task(Base):
    __tablename__ = "tt_tasks"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    category_id: Mapped[str] = mapped_column(ForeignKey("tt_categories.id", ondelete="RESTRICT"), index=True)
    name: Mapped[str] = mapped_column(String(240), index=True)
    notes: Mapped[str] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    archived: Mapped[bool] = mapped_column(Boolean, default=False)
    category: Mapped["Category"] = relationship()


class Workday(Base):
    __tablename__ = "tt_workdays"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    work_date: Mapped[date] = mapped_column(Date, index=True)
    timezone: Mapped[str] = mapped_column(String(64))
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    ended_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=True)
    open_key: Mapped[str] = mapped_column(String(8), nullable=True, unique=True)
    close_reason: Mapped[str] = mapped_column(String(32), nullable=True)
    entries: Mapped[list["TimeEntry"]] = relationship(back_populates="workday")


class TimeEntry(Base):
    __tablename__ = "tt_time_entries"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    workday_id: Mapped[str] = mapped_column(ForeignKey("tt_workdays.id", ondelete="RESTRICT"), index=True)
    task_id: Mapped[str] = mapped_column(ForeignKey("tt_tasks.id", ondelete="RESTRICT"), index=True)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    ended_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=True)
    open_key: Mapped[str] = mapped_column(String(36), nullable=True, unique=True)
    state: Mapped[str] = mapped_column(String(16), default="running")
    active_seconds: Mapped[int] = mapped_column(Integer, default=0)
    idle_seconds: Mapped[int] = mapped_column(Integer, default=0)
    paused_seconds: Mapped[int] = mapped_column(Integer, default=0)
    close_reason: Mapped[str] = mapped_column(String(32), nullable=True)
    workday: Mapped[Workday] = relationship(back_populates="entries")
    segments: Mapped[list["ActivitySegment"]] = relationship(back_populates="entry", cascade="all, delete-orphan")


class ActivitySegment(Base):
    __tablename__ = "tt_activity_segments"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    entry_id: Mapped[str] = mapped_column(ForeignKey("tt_time_entries.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(16))  # active | idle | paused
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    ended_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=True)
    open_key: Mapped[str] = mapped_column(String(36), nullable=True, unique=True)
    entry: Mapped[TimeEntry] = relationship(back_populates="segments")


class OutboxRecord(Base):
    __tablename__ = "tt_sync_outbox"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    record_type: Mapped[str] = mapped_column(String(32), index=True)
    record_id: Mapped[str] = mapped_column(String(36), index=True)
    payload: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    revision: Mapped[int] = mapped_column(Integer, default=1)
    synced_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=True)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    last_error: Mapped[str] = mapped_column(Text, nullable=True)
    __table_args__ = (UniqueConstraint("record_type", "record_id", name="uq_outbox_record"),)


class RuntimeState(Base):
    __tablename__ = "tt_runtime_state"
    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[str] = mapped_column(Text)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class PublishedReport(Base):
    __tablename__ = "tt_published_reports"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    report_key: Mapped[str] = mapped_column(String(120), unique=True, index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    period: Mapped[str] = mapped_column(String(24))
    start_date: Mapped[date] = mapped_column(Date)
    end_date: Mapped[date] = mapped_column(Date)
    payload: Mapped[dict] = mapped_column(JSON)
    published_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
