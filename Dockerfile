FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt && useradd --create-home --uid 10001 appuser
COPY app.py content.py project_sheets.py photo_library.py media_catalog.py seo_panel.py case_studies.py lead_analytics.py enquiry_fields.py ./
COPY templates/ templates/
COPY static/ static/
COPY content/ content/
RUN mkdir -p /data/files && chown -R appuser:appuser /data
USER appuser
ENV DATA_DIR=/data
EXPOSE 8000
CMD ["gunicorn", "--bind", "0.0.0.0:8000", "--workers", "2", "--threads", "4", "--timeout", "60", "app:create_app()"]
