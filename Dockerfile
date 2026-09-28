FROM node:20-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-venv ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json /app/
RUN npm config set registry https://registry.npmmirror.com \
  && npm install --omit=dev

RUN python3 -m venv /opt/edgejev-venv \
  && /opt/edgejev-venv/bin/pip install --no-cache-dir --upgrade pip \
  && /opt/edgejev-venv/bin/pip install --no-cache-dir edgejev==0.4.0

ENV PATH="/opt/edgejev-venv/bin:$PATH"
ENV EDGEJEV_MODEL_DIR="/models/jev-int8"
ENV EDGEJEV_PORT="8009"

COPY . /app
RUN chmod +x /app/scripts/start.sh \
  && mkdir -p /models/jev-int8

CMD ["/app/scripts/start.sh"]
