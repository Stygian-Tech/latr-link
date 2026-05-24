# syntax=docker/dockerfile:1

FROM swift:6.0-jammy AS builder

WORKDIR /src
COPY services/latr-gateway/ ./services/latr-gateway/

WORKDIR /src/services/latr-gateway
RUN swift build -c release --static-swift-stdlib

FROM ubuntu:22.04

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /src/services/latr-gateway/.build/release/LatrGateway /usr/local/bin/latr-gateway

ENV PORT=8080
EXPOSE 8080
USER nobody
ENTRYPOINT ["latr-gateway"]
