# TaskTracker desktop client

## Development

Requirements: Windows, Node.js 20+, Python 3.11+ and the Python launcher (`py`). From the repository root, install the backend dependencies once:

```powershell
py -3 -m pip install -r requirements.txt
cd ui
npm install
npm run dev
```

The Electron development shell launches the Python API directly. It does not install Python packages each time the app opens. The API binds only to `127.0.0.1:8765` and stores its database under the current user's LocalAppData directory.

## Build and package for Windows

From `ui`:

```powershell
npm run dist
```

Packaging uses the build machine's Python installation to create a one-file backend executable with PyInstaller. The installer contains that executable and the UI assets; end users do not need Python, pip, or an internet connection to start TaskTracker. The NSIS installer is written to `ui/release/`. `npm run pack` creates an unpacked app in the same output folder for inspection and launch checks.

The packaged backend binds to loopback and stores SQLite under `%LOCALAPPDATA%\TaskTracker\tasktracker.sqlite3`. No hosted SQL credentials are embedded in the app. The packaged app is configured to launch when the user signs in to Windows.

## Host the public report dashboard

Build the static dashboard with the API origin configured at build time:

```powershell
$env:VITE_API_BASE_URL = 'https://<your-vps-host>/api/v1'
npm run build:vite
```

Serve `dist/` over HTTPS. Configure the web server to proxy `/api/v1/` to the VPS FastAPI service, and send browser routes such as `/report/<shareToken>` to `index.html`. For nginx, the relevant behavior is:

```nginx
location /api/v1/ {
    proxy_pass http://127.0.0.1:8765/api/v1/;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
}

location / {
    try_files $uri $uri/ /index.html;
}
```

The public dashboard calls only `GET /api/v1/public/reports/:shareToken`; it does not contain the private report or sync bearer tokens. Configure TLS and the API host/reverse proxy before sharing links.
