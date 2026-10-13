FROM node:22-alpine AS ui-build
WORKDIR /ui
COPY ui/package.json ui/package-lock.json ./
RUN npm ci
COPY ui ./
RUN npm run build:vite

FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 APP_MODE=server APP_HOST=0.0.0.0 APP_PORT=8765
WORKDIR /app
COPY requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
COPY src ./src
COPY --from=ui-build /ui/dist ./ui-dist
RUN useradd --create-home --uid 10001 tasktracker
USER tasktracker
EXPOSE 8765
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8765/health', timeout=4)"
CMD ["uvicorn", "tasktracker.api:app", "--app-dir", "src", "--host", "0.0.0.0", "--port", "8765", "--proxy-headers"]
