# syntax=docker/dockerfile:1
# Build context: monorepo root. No Swift toolchain or sibling packages required.

FROM golang:1.27.1-bookworm AS builder

WORKDIR /src/services/latr-gateway
COPY services/latr-gateway/go.mod services/latr-gateway/go.sum ./
RUN go mod download
COPY services/latr-gateway/cmd ./cmd
COPY services/latr-gateway/internal ./internal
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/latr-gateway ./cmd/latr-gateway

FROM debian:bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates postgresql-client \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /out/latr-gateway /usr/local/bin/latr-gateway
COPY services/latr-gateway/migrations /app/database/migrations
COPY scripts/apply-database-migrations.sh /usr/local/bin/apply-database-migrations

RUN chmod +x /usr/local/bin/latr-gateway /usr/local/bin/apply-database-migrations

RUN mkdir -p /var/lib/latr-gateway/data \
    && chown -R nobody:nogroup /var/lib/latr-gateway

WORKDIR /var/lib/latr-gateway

ENV PORT=8080
ENV LATR_GATEWAY_DEVELOPER_STORE_PATH=/var/lib/latr-gateway/data/developer-store.json
ENV MIGRATIONS_DIR=/app/database/migrations
EXPOSE 8080
USER nobody
ENTRYPOINT ["latr-gateway"]
