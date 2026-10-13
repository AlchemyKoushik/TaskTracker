from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class CategoryCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    color: str | None = Field(default=None, max_length=24)

    @field_validator("name")
    @classmethod
    def name_must_not_be_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Name must contain at least one non-whitespace character.")
        return value


class CategoryView(CategoryCreate):
    model_config = ConfigDict(from_attributes=True)
    id: str
    created_at: datetime
    archived: bool


class TaskCreate(BaseModel):
    name: str = Field(min_length=1, max_length=240)
    category_id: str
    notes: str | None = Field(default=None, max_length=4000)

    @field_validator("name")
    @classmethod
    def name_must_not_be_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Name must contain at least one non-whitespace character.")
        return value

    @field_validator("category_id")
    @classmethod
    def category_id_must_not_be_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Choose a category.")
        return value


class TaskView(TaskCreate):
    model_config = ConfigDict(from_attributes=True)
    id: str
    created_at: datetime
    updated_at: datetime
    archived: bool
    category: CategoryView | None = None


class StartTaskRequest(BaseModel):
    task_id: str


class SettingsPatch(BaseModel):
    idle_threshold_seconds: int | None = Field(default=None, ge=30, le=3600)


class SyncRecord(BaseModel):
    type: Literal["category", "task", "workday", "time_entry", "activity_segment"]
    id: str
    data: dict


class SyncPushRequest(BaseModel):
    records: list[SyncRecord] = Field(min_length=1, max_length=500)


class PublishReportRequest(BaseModel):
    period: Literal["previous_week", "previous_month"]


class ReportRange(BaseModel):
    start_date: date
    end_date: date


class ErrorBody(BaseModel):
    error: str
    message: str


class ApiEnvelope(BaseModel):
    ok: bool = True
