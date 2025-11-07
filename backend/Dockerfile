# backend/Dockerfile
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

# System deps (build + runtime for pyscard, psycopg2-binary is prebuilt)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    gcc \
    g++ \
    libpcsclite1 \
    libpcsclite-dev \
    pcscd \
    swig \
    pkg-config \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN useradd -m appuser
WORKDIR /app

# Install Python deps
COPY requirements.txt .
RUN pip install --upgrade pip setuptools wheel && \
    pip install -r requirements.txt

# Copy app code
COPY . .

# Runtime env - Railway will override this with $PORT
ENV PORT=8080
EXPOSE 8080

# Start FastAPI on 0.0.0.0 using Railway's PORT (defaults to 8080)
# Using exec form with shell to support env var substitution
CMD ["sh", "-c", "uvicorn app:app --host 0.0.0.0 --port $PORT --no-access-log"]
