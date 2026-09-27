# CACAO Roaster Service

## Canonical reader guidance

Start with [app-owned service tasks](https://github.com/service-lasso/service-lasso/blob/develop/docs/components/app-service-tasks.md) for CACAO/SOARCA pairing in a consuming app. This page retains the component's manifest, runtime and packaging contracts. CACAO remains opt-in; source instructions do not establish installed-platform acceptance or release publication. Migration: [CACAO #6](https://github.com/service-lasso/lasso-cacao-roaster/issues/6), [Core #1419](https://github.com/service-lasso/service-lasso/issues/1419), reviewed source `bdc074e1ba0d90f873a372a090d8af26748322b9`.

`lasso-cacao-roaster` packages CACAO Roaster 1.3.0 as a Service Lasso managed web UI.

## Defaults

- Service ID: `cacao-roaster`
- Upstream version: `1.3.0`
- Runtime provider: `@node`
- Dependency: `soarca`
- Default HTTP port: `3000`
- Healthchecks: `http-health` -> `GET /healthcheck`

## SOARCA Pairing

CACAO Roaster authors CACAO playbooks and SOARCA executes them. Service Lasso exposes `SOARCA_URL` from the `soarca` service, then this service passes that value into the CACAO Roaster bundle at runtime as the upstream `SOARCA_END_POINT` setting.

## Release Assets

Each GitHub release publishes platform archives, `service.json`, and `SHA256SUMS.txt`.

The platform archives contain:

- `public/` with the built CACAO Roaster static UI
- `server.mjs` with the Service Lasso runtime web server
- `SERVICE-LASSO-PACKAGE.json` with source and packaging metadata
