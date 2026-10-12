from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from tasktracker.settings import get_settings


class Base(DeclarativeBase):
    pass


def _make_engine():
    uri = get_settings().database_uri
    kwargs = {"pool_pre_ping": True}
    if uri.startswith("sqlite"):
        kwargs["connect_args"] = {"check_same_thread": False, "timeout": 30}
    engine = create_engine(uri, **kwargs)
    if uri.startswith("sqlite"):
        @event.listens_for(engine, "connect")
        def _sqlite_pragmas(dbapi_connection, _record):
            cursor = dbapi_connection.cursor()
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.execute("PRAGMA journal_mode=WAL")
            cursor.close()
    return engine


engine = _make_engine()
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def initialize_database() -> None:
    from tasktracker import models  # noqa: F401

    Base.metadata.create_all(bind=engine)
