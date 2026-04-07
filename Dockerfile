FROM python:3.13-slim

WORKDIR /app

COPY server.py .
COPY static/ ./static/
COPY data/ ./data/

RUN mkdir -p /app/uploads

EXPOSE 3000

CMD ["python", "server.py"]
