# FIREWORK CHRONOS backend (FastAPI). Used by Render and Railway; the frontend goes to Vercel separately.
FROM python:3.13-slim

ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1
WORKDIR /app

COPY backend/requirements.txt backend/requirements.txt
RUN pip install -r backend/requirements.txt

COPY backend backend
COPY frontend/public/data frontend/public/data
COPY data/supabase/csv data/supabase/csv
COPY data/processed data/processed
COPY ml/models ml/models
COPY pipeline/regions.json pipeline/regions.json

RUN mkdir -p data/cache
WORKDIR /app/backend
EXPOSE 8000
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers --forwarded-allow-ips='*'"]
