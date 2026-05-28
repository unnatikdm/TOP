FROM python:3.11-slim

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    git \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install Coral CLI natively in the container
RUN curl -fsSL https://withcoral.com/install.sh | sh

# Add Coral CLI to the PATH
ENV PATH="/root/.local/bin:${PATH}"

# Set the working directory
WORKDIR /app

# Copy python dependencies and install
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy static frontend files and backend source code
COPY index.html ./backend/
COPY dashboard/ ./backend/dashboard/
COPY enterprise-agent/backend/ ./backend/
COPY enterprise-agent/skills/ ./skills/

EXPOSE 8000

# Start backend from the backend directory
WORKDIR /app/backend
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
