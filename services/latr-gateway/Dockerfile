# syntax=docker/dockerfile:1
# Build context: services/latr-gateway (LatrKit resolves from GitHub via SwiftPM).

FROM swift:6.1-jammy AS builder

WORKDIR /src
COPY . .

RUN swift build -c release --static-swift-stdlib

FROM ubuntu:22.04

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /src/.build/release/LatrGateway /usr/local/bin/latr-gateway

RUN mkdir -p /var/lib/latr-gateway/data \
    && chown -R nobody:nogroup /var/lib/latr-gateway

WORKDIR /var/lib/latr-gateway

ENV PORT=8080
ENV LATR_GATEWAY_DEVELOPER_STORE_PATH=/var/lib/latr-gateway/data/developer-store.json
EXPOSE 8080
USER nobody
ENTRYPOINT ["latr-gateway"]
