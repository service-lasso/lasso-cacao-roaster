# lasso-cacao-roaster

`lasso-cacao-roaster` packages [CACAO Roaster](https://github.com/opencybersecurityalliance/cacao-roaster) as a Service Lasso managed web UI.

CACAO Roaster is an app-owned CACAO playbook authoring surface. It is disabled by default because each consuming app decides when it wants CACAO authoring and which SOARCA instance should execute playbooks.

## Service Contract

- Service ID: `cacao-roaster`
- Upstream version: `1.3.0`
- Runtime provider: `@node`
- Required dependency: `soarca`
- Default HTTP port: `3000`
- Healthchecks: `http-health` -> `GET http://127.0.0.1:${SERVICE_PORT}/healthcheck`
- First package platforms: Windows x64, Linux x64, macOS arm64

## Release Artifacts

Pushes to `main` create a GitHub release named with the Service Lasso version pattern:

```text
yyyy.m.d-<shortsha>
```

The release contains:

- `lasso-cacao-roaster-1.3.0-win32.zip`
- `lasso-cacao-roaster-1.3.0-linux.tar.gz`
- `lasso-cacao-roaster-1.3.0-darwin.tar.gz`
- `service.json`
- `SHA256SUMS.txt`

## Local Validation

```powershell
npm test
```

The verifier downloads the public upstream `v1.3.0` source tag, builds the static UI, packages the Service Lasso runtime wrapper, starts it on a temporary port, checks `/healthcheck`, checks the UI, verifies runtime `SOARCA_URL` injection, and stops the process.

## SOARCA Pairing

CACAO Roaster consumes SOARCA through the upstream `SOARCA_END_POINT` browser setting. Service Lasso exposes the runtime contract as `SOARCA_URL`, then the packaged runtime server injects that value into the built bundle so consuming apps can wire `cacao-roaster` to the local `soarca` service without rebuilding the UI.

Apps that want CACAO authoring and execution should include both:

- `services/soarca/service.json`
- `services/cacao-roaster/service.json`

## Sources

- Upstream release: https://github.com/opencybersecurityalliance/cacao-roaster/releases/tag/v1.3.0
