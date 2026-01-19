FROM python:3.12-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app

COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

# Копируем весь проект (важно, чтобы попал core/frontend)
COPY . /app

EXPOSE 8000

CMD ["uvicorn", "core.backend.api.main:app", "--host", "0.0.0.0", "--port", "8000"]
