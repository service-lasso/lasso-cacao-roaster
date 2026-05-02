# CACAO Roaster Service

`lasso-cacao-roaster` packages CACAO Roaster 1.3.0 as a Service Lasso managed web UI.

## Defaults

- Service ID: `cacao-roaster`
- Upstream version: `1.3.0`
- Runtime provider: `@node`
- Dependency: `soarca`
- Default HTTP port: `3000`
- Healthcheck: `GET /healthcheck`

## SOARCA Pairing

CACAO Roaster authors CACAO playbooks and SOARCA executes them. Service Lasso exposes `SOARCA_URL` from the `soarca` service, then this service passes that value into the CACAO Roaster bundle at runtime as the upstream `SOARCA_END_POINT` setting.

## Release Assets

Each GitHub release publishes platform archives, `service.json`, and `SHA256SUMS.txt`.

The platform archives contain:

- `public/` with the built CACAO Roaster static UI
- `server.mjs` with the Service Lasso runtime web server
- `SERVICE-LASSO-PACKAGE.json` with source and packaging metadata
