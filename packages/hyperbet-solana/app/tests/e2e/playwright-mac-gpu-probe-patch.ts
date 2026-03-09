import childProcess, {
  type ExecSyncOptionsWithBufferEncoding,
  type ExecSyncOptionsWithStringEncoding,
} from "node:child_process";

const MAC_GPU_PROBE_COMMAND = "system_profiler SPDisplaysDataType";
const PATCH_FLAG = "__hyperbetMacGpuProbePatchApplied";

type ExecSyncOptions =
  | ExecSyncOptionsWithBufferEncoding
  | ExecSyncOptionsWithStringEncoding;

export function patchPlaywrightMacGpuProbe(): void {
  if (process.platform !== "darwin") return;

  const childProcessWithFlag = childProcess as typeof childProcess & {
    [PATCH_FLAG]?: boolean;
  };
  if (childProcessWithFlag[PATCH_FLAG]) return;

  const originalExecSync = childProcess.execSync.bind(childProcess);
  const timeoutMs = Number(process.env.PW_MAC_GPU_PROBE_TIMEOUT_MS ?? "1500");

  childProcess.execSync = ((command, options) => {
    if (typeof command !== "string" || command.trim() !== MAC_GPU_PROBE_COMMAND) {
      return originalExecSync(command, options);
    }

    try {
      const nextOptions: ExecSyncOptions = {
        timeout: timeoutMs,
        maxBuffer: 1024 * 1024,
        ...options,
      };
      return originalExecSync(command, nextOptions);
    } catch {
      return Buffer.from("");
    }
  }) as typeof childProcess.execSync;

  childProcessWithFlag[PATCH_FLAG] = true;
}
