# backend/Dockerfile
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

# System deps (build + runtime for pyscard, psycopg2-binary is prebuilt)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libpcsclite1 \
    libpcsclite-dev \
    pcscd \
    pscs-tools \
    pkg-config \
    libssl-dev\
    curl \
 && rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN useradd -m appuser
WORKDIR /app

# Install Python deps
COPY requirements.txt .
RUN pip install -r requirements.txt

# Copy app code
COPY . .

# Runtime env
ENV PORT=8080
EXPOSE 8080

# Start FastAPI (Railway injects $PORT)
CMD ["sh", "-c", "uvicorn app:app --host 0.0.0.0 --port ${PORT}"]
