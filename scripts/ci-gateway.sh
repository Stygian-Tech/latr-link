#!/usr/bin/env bash
# Gateway Go tests, static analysis, and release build.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/services/latr-gateway"

test -z "$(gofmt -l cmd internal)"
go mod download
go test -race ./...
go vet ./...
mkdir -p .build/go
CGO_ENABLED=0 go build -trimpath -o .build/go/latr-gateway ./cmd/latr-gateway
