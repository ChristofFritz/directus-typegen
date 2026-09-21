# Changelog

## 2.0.1 (2026-09-21)

- Published through npm trusted publishing (OIDC) with provenance. No code changes.

## 2.0.0 (2026-09-21)

Fork of [directus-typescript-gen](https://github.com/elierotenberg/directus-typescript-gen) 1.0, renamed to `directus-typegen`. Targets Directus 12 and `@directus/sdk` 25.

### Breaking

- Generated output no longer contains the full OpenAPI `components`/`paths` types. Each collection becomes its own exported type (`ItemsArticle`, `Users`, …) and the schema type references those directly.
- Relational fields are emitted in the shapes `@directus/sdk` expects: `string | Related` (m2o), `number[] | Related[]` (o2m/m2m), `item: string | A | B` plus a literal `collection` union (m2a).
- Fields are no longer optional; nullability is expressed as `| null`.
- System collections referenced by your collections (`directus_users`, `directus_files`, …) are included in the schema automatically.
- CLI: `--host` alias is `-u` (was `-h`, which clashed with `--help`). Environment variables are read only for `DIRECTUS_HOST`, `DIRECTUS_TOKEN`, `DIRECTUS_EMAIL`, `DIRECTUS_PASSWORD`.
- `generateTypeScript` is synchronous and accepts the raw spec as `unknown`.

### Added

- `--token` / `DIRECTUS_TOKEN`: authenticate with a static access token.
- `--includeSystem`: add all system collections to the schema.
- Singleton collections are emitted as plain objects.
- Collection names that are not valid identifiers are quoted.
- Readable errors for HTTP failures, including Directus error codes.
- `listCollections()` in the programmatic API.
- Unit tests and an integration test against a real Directus 12.3.1 (Docker / GitHub Actions).

### Removed

- Dependency on `openapi-typescript`.
