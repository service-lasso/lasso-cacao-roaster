import { spawnSync } from "node:child_process";
import { chmod, cp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serviceVersion = process.env.CACAO_ROASTER_VERSION ?? "1.3.0";
const targetPlatform = process.env.TARGET_PLATFORM ?? process.platform;
const upstreamTag = `v${serviceVersion}`;
const sourceArchiveUrl = `https://github.com/opencybersecurityalliance/cacao-roaster/archive/refs/tags/${upstreamTag}.tar.gz`;
const soarcaPlaceholder = "__SERVICE_LASSO_SOARCA_URL__";

const targets = {
  win32: { archiveType: "zip" },
  linux: { archiveType: "tar.gz" },
  darwin: { archiveType: "tar.gz" },
};

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: "inherit",
    shell: false,
    ...options,
  });

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}: ${result.error?.message ?? "unknown error"}`);
  }
}

function runNpm(args, options = {}) {
  if (process.platform === "win32") {
    run("cmd.exe", ["/d", "/s", "/c", ["npm", ...args].join(" ")], options);
    return;
  }

  run("npm", args, options);
}

function versionedAssetName(version, platform, archiveType) {
  return `lasso-cacao-roaster-${version}-${platform}.${archiveType === "zip" ? "zip" : "tar.gz"}`;
}

async function downloadFile(url, target) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "lasso-cacao-roaster-package",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.status} ${await response.text()}`);
  }

  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, Buffer.from(await response.arrayBuffer()));
}

async function compressPackage(packageRoot, outputPath, archiveType) {
  await mkdir(path.dirname(outputPath), { recursive: true });
  await rm(outputPath, { force: true });

  if (archiveType === "zip") {
    run("powershell", [
      "-NoLogo",
      "-NoProfile",
      "-Command",
      `Compress-Archive -Path ${JSON.stringify(path.join(packageRoot, "*"))} -DestinationPath ${JSON.stringify(outputPath)} -Force`,
    ]);
    return outputPath;
  }

  run("tar", ["-czf", outputPath, "-C", packageRoot, "."]);
  return outputPath;
}

async function prepareSource(sourceRoot, downloadRoot) {
  const archivePath = path.join(downloadRoot, `${upstreamTag}.tar.gz`);
  await rm(sourceRoot, { recursive: true, force: true });
  await mkdir(sourceRoot, { recursive: true });
  await downloadFile(sourceArchiveUrl, archivePath);
  run("tar", ["-xzf", archivePath, "-C", sourceRoot, "--strip-components", "1"]);

  await writeFile(
    path.join(sourceRoot, ".env"),
    [
      `SOARCA_END_POINT="${soarcaPlaceholder}"`,
      `SOARCA_URL="${soarcaPlaceholder}"`,
      "",
    ].join("\n"),
    "utf8",
  );
}

async function buildUpstream(sourceRoot) {
  runNpm(["pkg", "delete", "scripts.prepare"], { cwd: sourceRoot });
  runNpm(["ci", "--ignore-scripts"], { cwd: sourceRoot });
  runNpm(["run", "build"], { cwd: sourceRoot });
}

async function writeRuntimeServer(packageRoot) {
  await writeFile(
    path.join(packageRoot, "server.mjs"),
    String.raw`import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.dirname(fileURLToPath(import.meta.url));
const publicRoot = path.join(packageRoot, "public");
const port = Number(process.env.SERVICE_PORT ?? process.env.PORT ?? process.env.CACAO_ROASTER_PORT ?? "3000");
const host = process.env.CACAO_ROASTER_HOST ?? "127.0.0.1";
const fallbackSoarcaUrl = "http://127.0.0.1:8080";
const soarcaUrl = process.env.SOARCA_URL ?? process.env.SOARCA_END_POINT ?? fallbackSoarcaUrl;
const placeholder = "__SERVICE_LASSO_SOARCA_URL__";

const mimeTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".eot", "application/vnd.ms-fontobject"],
  [".html", "text/html; charset=utf-8"],
  [".js", "application/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml; charset=utf-8"],
  [".ttf", "font/ttf"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
]);

function escapeForJavaScriptString(value) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function send(response, status, body, headers = {}) {
  response.writeHead(status, headers);
  response.end(body);
}

function safeStaticPath(requestUrl) {
  const url = new URL(requestUrl ?? "/", "http://127.0.0.1");
  const decoded = decodeURIComponent(url.pathname);
  const requested = decoded === "/" ? "/index.html" : decoded;
  const resolved = path.resolve(publicRoot, "." + requested);
  const relative = path.relative(publicRoot, resolved);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return null;
  }

  return resolved;
}

async function readStaticFile(filePath) {
  const fileStat = await stat(filePath);
  if (fileStat.isDirectory()) {
    return readStaticFile(path.join(filePath, "index.html"));
  }

  const extension = path.extname(filePath).toLowerCase();
  const contentType = mimeTypes.get(extension) ?? "application/octet-stream";

  if (extension === ".js") {
    const source = await readFile(filePath, "utf8");
    return {
      contentType,
      body: source.replaceAll(placeholder, escapeForJavaScriptString(soarcaUrl)),
    };
  }

  return {
    contentType,
    body: await readFile(filePath),
  };
}

const server = createServer(async (request, response) => {
  if (request.url === "/healthcheck" || request.url === "/health") {
    send(response, 200, JSON.stringify({ ok: true, service: "cacao-roaster", soarcaUrl }), {
      "content-type": "application/json; charset=utf-8",
    });
    return;
  }

  const filePath = safeStaticPath(request.url);
  if (!filePath) {
    send(response, 403, "Forbidden", { "content-type": "text/plain; charset=utf-8" });
    return;
  }

  try {
    const file = await readStaticFile(filePath);
    send(response, 200, file.body, { "content-type": file.contentType });
  } catch (error) {
    if (error?.code === "ENOENT") {
      const fallback = await readStaticFile(path.join(publicRoot, "index.html"));
      send(response, 200, fallback.body, { "content-type": fallback.contentType });
      return;
    }

    console.error(error);
    send(response, 500, "Internal Server Error", { "content-type": "text/plain; charset=utf-8" });
  }
});

server.listen(port, host, () => {
  console.log("[lasso-cacao-roaster] listening on http://" + host + ":" + port);
  console.log("[lasso-cacao-roaster] SOARCA endpoint " + soarcaUrl);
});

process.on("SIGTERM", () => {
  server.close(() => process.exit(0));
});
`,
    "utf8",
  );
}

export async function packageCacaoRoaster(platform = targetPlatform, version = serviceVersion) {
  const target = targets[platform];
  if (!target) {
    throw new Error(`Unsupported target platform: ${platform}. Supported platforms: ${Object.keys(targets).join(", ")}.`);
  }

  const outputRoot = path.join(repoRoot, "output", "package", version, platform);
  const sourceRoot = path.join(outputRoot, "source");
  const downloadRoot = path.join(outputRoot, "downloads");
  const packageRoot = path.join(outputRoot, "payload");
  const distRoot = path.join(repoRoot, "dist");
  const outputPath = path.join(distRoot, versionedAssetName(version, platform, target.archiveType));

  await rm(outputRoot, { recursive: true, force: true });
  await mkdir(packageRoot, { recursive: true });
  await mkdir(distRoot, { recursive: true });

  await prepareSource(sourceRoot, downloadRoot);
  await buildUpstream(sourceRoot);
  await cp(path.join(sourceRoot, "dist"), path.join(packageRoot, "public"), { recursive: true });
  await writeRuntimeServer(packageRoot);
  await writeFile(
    path.join(packageRoot, "SERVICE-LASSO-PACKAGE.json"),
    `${JSON.stringify(
      {
        serviceId: "cacao-roaster",
        version,
        packagedBy: "service-lasso/lasso-cacao-roaster",
        platform,
        arch: "x64",
        command: "node ./server.mjs",
        upstream: {
          repo: "opencybersecurityalliance/cacao-roaster",
          tag: upstreamTag,
          sourceArchiveUrl,
        },
        runtime: {
          soarcaPlaceholder,
          healthcheck: "/healthcheck",
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  if (platform !== "win32") {
    await chmod(path.join(packageRoot, "server.mjs"), 0o755);
  }

  await compressPackage(packageRoot, outputPath, target.archiveType);
  console.log(`[lasso-cacao-roaster] packaged ${outputPath}`);
  return outputPath;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await packageCacaoRoaster();
}
