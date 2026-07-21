import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { packageCacaoRoaster } from "./package.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serviceVersion = process.env.CACAO_ROASTER_VERSION ?? "1.3.0";
const targetPlatform = process.env.TARGET_PLATFORM ?? process.platform;
const testSoarcaUrl = "http://127.0.0.1:18080";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: "inherit",
    shell: false,
    ...options,
  });

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}`);
  }
}

function archiveName(platform) {
  const ext = platform === "win32" ? "zip" : "tar.gz";
  return `lasso-cacao-roaster-${serviceVersion}-${platform}.${ext}`;
}

async function reserveLoopbackPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Failed to reserve loopback port.")));
        return;
      }
      server.close(() => resolve(address.port));
    });
  });
}

async function extractArchive(archivePath, destination) {
  await rm(destination, { recursive: true, force: true });
  await mkdir(destination, { recursive: true });

  if (archivePath.endsWith(".zip")) {
    run("powershell", [
      "-NoLogo",
      "-NoProfile",
      "-Command",
      `Expand-Archive -Path ${JSON.stringify(archivePath)} -DestinationPath ${JSON.stringify(destination)} -Force`,
    ]);
    return;
  }

  run("tar", ["-xzf", archivePath, "-C", destination]);
}

async function waitForHttp(url, expectedStatus = 200, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.status === expectedStatus) {
        return response;
      }
      lastError = new Error(`Expected ${expectedStatus} from ${url}, got ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(500);
  }

  throw lastError ?? new Error(`Timed out waiting for ${url}`);
}

async function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("close", resolve)),
    sleep(10_000).then(() => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
      }
    }),
  ]);
}

const archivePath = await packageCacaoRoaster(targetPlatform, serviceVersion);
const expectedArchive = path.join(repoRoot, "dist", archiveName(targetPlatform));
if (archivePath !== expectedArchive || !existsSync(expectedArchive)) {
  throw new Error(`Expected archive was not created: ${expectedArchive}`);
}

const verifyRoot = path.join(repoRoot, "output", "verify", serviceVersion, targetPlatform);
const extractRoot = path.join(verifyRoot, "extract");
const port = await reserveLoopbackPort();
const serviceManifest = JSON.parse(await readFile(path.join(repoRoot, "service.json"), "utf8"));

if (serviceManifest.id !== "cacao-roaster" || serviceManifest.version !== serviceVersion) {
  throw new Error(`Unexpected manifest identity: ${JSON.stringify({ id: serviceManifest.id, version: serviceManifest.version })}`);
}

if (serviceManifest.execservice !== "@node" || !serviceManifest.depend_on?.includes("@node") || !serviceManifest.depend_on?.includes("soarca")) {
  throw new Error("CACAO Roaster manifest must run through @node and depend on soarca.");
}

if ("healthcheck" in serviceManifest) {
  throw new Error("CACAO Roaster manifest must use canonical healthchecks[] and not singular healthcheck.");
}

if (
  !Array.isArray(serviceManifest.healthchecks) ||
  serviceManifest.healthchecks.length !== 1 ||
  serviceManifest.healthchecks[0]?.id !== "http-health" ||
  serviceManifest.healthchecks[0]?.type !== "http" ||
  serviceManifest.healthchecks[0]?.url !== "${CACAO_ROASTER_URL}/healthcheck"
) {
  throw new Error(`Unexpected healthchecks contract: ${JSON.stringify(serviceManifest.healthchecks)}`);
}

await extractArchive(expectedArchive, extractRoot);

const metadata = JSON.parse(await readFile(path.join(extractRoot, "SERVICE-LASSO-PACKAGE.json"), "utf8"));
if (
  metadata.serviceId !== "cacao-roaster" ||
  metadata.version !== serviceVersion ||
  metadata.platform !== targetPlatform ||
  metadata.upstream?.tag !== `v${serviceVersion}`
) {
  throw new Error(`Unexpected package metadata: ${JSON.stringify(metadata)}`);
}

const child = spawn(process.execPath, ["./server.mjs"], {
  cwd: extractRoot,
  env: {
    ...process.env,
    SERVICE_PORT: String(port),
    PORT: String(port),
    CACAO_ROASTER_PORT: String(port),
    SOARCA_URL: testSoarcaUrl,
  },
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true,
});

let stdout = "";
let stderr = "";
child.stdout?.on("data", (chunk) => {
  stdout += chunk.toString();
});
child.stderr?.on("data", (chunk) => {
  stderr += chunk.toString();
});

try {
  const baseUrl = `http://127.0.0.1:${port}`;
  const health = await waitForHttp(`${baseUrl}/healthcheck`);
  const healthBody = await health.json();
  if (healthBody.service !== "cacao-roaster" || healthBody.soarcaUrl !== testSoarcaUrl) {
    throw new Error(`Unexpected health payload: ${JSON.stringify(healthBody)}`);
  }

  const ui = await waitForHttp(`${baseUrl}/`);
  const html = await ui.text();
  if (!html.includes("<title>CACAO Roaster</title>")) {
    throw new Error("CACAO Roaster UI title was not served.");
  }

  const bundleMatch = html.match(/src="([^"]*bundle[^"]+\.js)"/);
  if (!bundleMatch) {
    throw new Error("CACAO Roaster bundle reference was not found in index.html.");
  }

  const bundle = await (await waitForHttp(`${baseUrl}/${bundleMatch[1]}`)).text();
  if (!bundle.includes(testSoarcaUrl) || bundle.includes("__SERVICE_LASSO_SOARCA_URL__")) {
    throw new Error("Runtime SOARCA_URL replacement was not applied to the CACAO Roaster bundle.");
  }

  console.log(`[lasso-cacao-roaster] verified package, health, UI, and SOARCA runtime config on port ${port}`);
} catch (error) {
  console.error("[lasso-cacao-roaster] stdout:");
  console.error(stdout);
  console.error("[lasso-cacao-roaster] stderr:");
  console.error(stderr);
  throw error;
} finally {
  await stopChild(child);
}
