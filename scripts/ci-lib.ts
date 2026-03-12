import { spawn, spawnSync } from "node:child_process";
import {
  mkdirSync,
  cpSync,
  existsSync,
  writeFileSync,
  createWriteStream,
  openSync,
  closeSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function resolveArtifactRoot(name: string): string {
  const base =
    process.env.HYPERBET_CI_ARTIFACT_DIR?.trim() ||
    path.join(rootDir, ".ci-artifacts");
  const target = path.join(base, name);
  mkdirSync(target, { recursive: true });
  return target;
}

export function writeJsonArtifact(
  artifactRoot: string,
  relativePath: string,
  value: unknown,
): string {
  const filePath = path.join(artifactRoot, relativePath);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return filePath;
}

export function copyIntoArtifacts(
  artifactRoot: string,
  sourcePath: string,
  relativePath?: string,
): void {
  if (!existsSync(sourcePath)) return;
  const targetPath = path.join(
    artifactRoot,
    relativePath ?? path.basename(sourcePath),
  );
  if (path.resolve(sourcePath) === path.resolve(targetPath)) {
    return;
  }
  mkdirSync(path.dirname(targetPath), { recursive: true });
  cpSync(sourcePath, targetPath, { recursive: true });
}

export function runSync(
  command: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): void {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? rootDir,
    env: { ...process.env, ...options.env },
    stdio: "inherit",
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

export async function runCommand(
  command: string,
  args: string[],
  options: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    stdoutFile?: string;
    stderrFile?: string;
  } = {},
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? rootDir,
      env: { ...process.env, ...options.env },
      stdio: [
        "ignore",
        options.stdoutFile ? "pipe" : "inherit",
        options.stderrFile ? "pipe" : "inherit",
      ],
    });
    if (options.stdoutFile && child.stdout) {
      mkdirSync(path.dirname(options.stdoutFile), { recursive: true });
      const out = createWriteStream(options.stdoutFile, { flags: "a" });
      child.stdout.pipe(process.stdout);
      child.stdout.pipe(out);
    }
    if (options.stderrFile && child.stderr) {
      mkdirSync(path.dirname(options.stderrFile), { recursive: true });
      const err = createWriteStream(options.stderrFile, { flags: "a" });
      child.stderr.pipe(process.stderr);
      child.stderr.pipe(err);
    }
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} exited with ${code ?? 1}`));
    });
  });
}

export async function spawnBackground(
  command: string,
  args: string[],
  options: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    logFile: string;
  },
): Promise<{ pid: number; stop: () => void }> {
  mkdirSync(path.dirname(options.logFile), { recursive: true });
  const logFd = openSync(options.logFile, "a");
  const child = spawn(command, args, {
    cwd: options.cwd ?? rootDir,
    env: { ...process.env, ...options.env },
    stdio: ["ignore", logFd, logFd],
  });
  if (!child.pid) {
    closeSync(logFd);
    throw new Error(`failed to start background command: ${command}`);
  }
  const pid = child.pid;
  return {
    pid,
    stop: () => {
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        // Process already exited.
      }
      closeSync(logFd);
    },
  };
}

export async function waitForJsonEndpoint(
  url: string,
  options: {
    timeoutMs?: number;
    validate?: (payload: any) => boolean;
  } = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 120_000;
  const deadline = Date.now() + timeoutMs;
  let lastError = "endpoint did not become ready";
  while (Date.now() < deadline) {
    try {
      const response = spawnSync("curl", ["-fsS", url], {
        cwd: rootDir,
        encoding: "utf8",
      });
      if (response.status === 0) {
        const payload = JSON.parse(response.stdout || "null");
        if (!options.validate || options.validate(payload)) return;
        lastError = `validation failed for ${url}`;
      } else {
        lastError = (response.stderr || "").trim() || `curl failed for ${url}`;
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(lastError);
}
