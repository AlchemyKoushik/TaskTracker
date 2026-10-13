"""Packaged entry point for the local TaskTracker API."""

import os

import uvicorn


if __name__ == "__main__":
    uvicorn.run(
        "tasktracker.api:app",
        host=os.environ.get("APP_HOST", "127.0.0.1"),
        port=int(os.environ.get("APP_PORT", "8765")),
        log_level="info",
    )
