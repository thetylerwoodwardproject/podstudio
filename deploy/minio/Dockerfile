# MinIO no longer publishes pullable images (Docker Hub / Quay refuse pulls as of
# 2026-10), so build the server from source. Pin MINIO_REF to a release tag or
# commit once one is chosen; "latest" tracks the module's newest tag.
FROM golang:1-alpine AS build
ARG MINIO_REF=latest
RUN apk add --no-cache git && CGO_ENABLED=0 go install github.com/minio/minio@${MINIO_REF}

FROM alpine:3
RUN apk add --no-cache ca-certificates curl
COPY --from=build /go/bin/minio /usr/local/bin/minio
EXPOSE 9000
ENTRYPOINT ["minio"]
