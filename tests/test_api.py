import os
import tempfile
import unittest


class TaskLifecycleApiTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.database_file = tempfile.NamedTemporaryFile(suffix=".sqlite3", delete=False)
        cls.database_file.close()
        os.environ["APP_MODE"] = "local"
        os.environ["LOCAL_DATABASE_URL"] = f"sqlite:///{cls.database_file.name.replace(os.sep, '/')}"
        os.environ["APP_TIMEZONE"] = "Asia/Kolkata"

        from fastapi.testclient import TestClient
        from tasktracker.api import app

        cls.client = TestClient(app)
        cls.client.__enter__()

    @classmethod
    def tearDownClass(cls):
        cls.client.__exit__(None, None, None)
        from tasktracker.db import engine

        engine.dispose()
        os.unlink(cls.database_file.name)

    def test_create_and_run_task(self):
        response = self.client.post("/api/v1/categories", json={"name": "Engineering", "color": "#0ea5e9"})
        self.assertEqual(response.status_code, 201, response.text)
        category = response.json()

        response = self.client.post(
            "/api/v1/tasks",
            json={"name": "Production readiness", "category_id": category["id"], "notes": "verify end-to-end"},
        )
        self.assertEqual(response.status_code, 201, response.text)
        task = response.json()
        self.assertEqual(task["category"]["name"], "Engineering")

        response = self.client.get("/api/v1/bootstrap")
        self.assertEqual(response.status_code, 200, response.text)
        self.assertTrue(any(row["id"] == task["id"] for row in response.json()["tasks"]))

        response = self.client.post("/api/v1/tasks/start", json={"task_id": task["id"]})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["current_entry"]["task"]["name"], "Production readiness")

        response = self.client.get("/api/v1/current")
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["current_entry"]["current_segment"]["kind"], "active")

        response = self.client.post("/api/v1/tasks/pause")
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["current_entry"]["state"], "paused")

        response = self.client.post("/api/v1/tasks/resume")
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["current_entry"]["state"], "running")

        response = self.client.post("/api/v1/tasks/wrap-up")
        self.assertEqual(response.status_code, 200, response.text)
        self.assertIsNone(response.json()["current_entry"])

    def test_compiled_frontend_supports_browser_routes(self):
        response = self.client.get("/")
        self.assertEqual(response.status_code, 200, response.text)
        self.assertIn('<div id="root">', response.text)

        response = self.client.get("/report/example-token")
        self.assertEqual(response.status_code, 200, response.text)
        self.assertIn('<div id="root">', response.text)

        response = self.client.get("/api/v1/does-not-exist")
        self.assertEqual(response.status_code, 404, response.text)


if __name__ == "__main__":
    unittest.main()
