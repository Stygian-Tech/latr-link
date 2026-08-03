# syntax=docker/dockerfile:1
# Build context: monorepo root (LatrKit resolves from GitHub via SwiftPM).

FROM swift:6.1-jammy AS builder

WORKDIR /src
COPY services/latr-gateway/ ./services/latr-gateway/

WORKDIR /src/services/latr-gateway
RUN swift build -c release --static-swift-stdlib

FROM ubuntu:22.04

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates postgresql-client \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /src/services/latr-gateway/.build/release/LatrGateway /usr/local/bin/latr-gateway
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
