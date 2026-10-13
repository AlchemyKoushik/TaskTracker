from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


def _default_local_db() -> str:
    import os

    root = Path(os.environ.get("LOCALAPPDATA", Path.home() / ".local")) / "TaskTracker"
    root.mkdir(parents=True, exist_ok=True)
    return f"sqlite:///{(root / 'tasktracker.sqlite3').as_posix()}"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_mode: Literal["local", "server"] = "local"
    app_timezone: str = "Asia/Kolkata"
    app_host: str = "127.0.0.1"
    app_port: int = 8765
    idle_threshold_seconds: int = 60
    activity_poll_seconds: int = 2
    heartbeat_seconds: int = 5
    sync_interval_seconds: int = 60
    local_database_url: str | None = None
    database_url: str | None = None
    sync_api_url: str | None = None
    sync_api_token: str | None = None
    report_api_token: str | None = None
    public_report_signing_key: str | None = None
    public_dashboard_url: str | None = None
    web_dist_dir: str | None = None
    cors_origins: str = "app://tasktracker,http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173"

    @property
    def database_uri(self) -> str:
        if self.app_mode == "server":
            if not self.database_url:
                raise RuntimeError("DATABASE_URL must be configured in server mode")
            return self.database_url
        return self.local_database_url or _default_local_db()

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
