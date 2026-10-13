import tempfile
import unittest
from datetime import datetime, timezone

import httpx


class FakeResponse:
    def __init__(self, status_code: int):
        self.status_code = status_code
        self.request = httpx.Request("POST", "https://sync.test/api/v1/sync/push")

    def raise_for_status(self):
        if self.status_code >= 400:
            response = httpx.Response(self.status_code, request=self.request)
            raise httpx.HTTPStatusError("sync failed", request=self.request, response=response)


class FakeClient:
    def __init__(self, statuses: list[int]):
        self.statuses = iter(statuses)
        self.calls = []

    async def post(self, url, json, headers):
        self.calls.append(json)
        return FakeResponse(next(self.statuses))


class SyncFallbackTest(unittest.IsolatedAsyncioTestCase):
    async def test_dependency_batch_falls_back_to_individual_records(self):
        from sqlalchemy import create_engine, select
        from sqlalchemy.orm import sessionmaker

        from tasktracker import models
        from tasktracker.db import Base
        from tasktracker.sync import _sync_group

        database_file = tempfile.NamedTemporaryFile(suffix=".sqlite3", delete=False)
        database_file.close()
        engine = create_engine(f"sqlite:///{database_file.name}")
        Base.metadata.create_all(bind=engine)
        session = sessionmaker(bind=engine, expire_on_commit=False)()
        now = datetime.now(timezone.utc)
        rows = [
            models.OutboxRecord(
                id=f"outbox-{index}",
                record_type="task",
                record_id=f"task-{index}",
                payload={"id": f"task-{index}"},
                created_at=now,
                revision=1,
            )
            for index in range(2)
        ]
        session.add_all(rows)
        session.commit()

        client = FakeClient([503, 200, 200])
        result = await _sync_group(client, "https://sync.test", "token", session, rows)

        self.assertEqual(result, {"sent": 2, "error": None})
        self.assertEqual(len(client.calls), 3)
        pending = session.scalars(select(models.OutboxRecord).where(models.OutboxRecord.synced_at.is_(None))).all()
        self.assertEqual(pending, [])
        session.close()
        engine.dispose()


if __name__ == "__main__":
    unittest.main()
