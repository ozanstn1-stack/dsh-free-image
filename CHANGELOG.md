# Changelog

All notable changes to this project are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.0] - 2026-10-31

### Added

- `generate_image`: keyless image generation through a configured HTTP GET
  endpoint. Saves the image under the configured output directory and returns
  its absolute path, real pixel size and byte size.
- `list_image_models`: read-only inventory of the configured providers with
  endpoint, model, size limits, pacing and output directory.
- Single-flight queue so free endpoints are never hit in parallel.
- Rate-limit handling: `402`/`429`/`502`/`503`/`504` answers are retried after
  the wait the endpoint asks for, within a bounded per-call budget; a wait that
  does not fit is reported instead of failing blindly.
- Config schema for providers, defaults, output directory/size cap and retry
  policy. No credentials are stored or read.
- UTF-8-safe prompt validation, size clamping, image header sniffing (PNG/JPEG),
  file-name slugging and collision handling.
- Unit tests for URL building, rate-limit parsing, sizing, file naming, image
  header parsing, the retry path, the size cap, unknown providers and queue
  serialization.
