import { spawnSync } from "node:child_process";
import path from "node:path";

import { copyIntoArtifacts, resolveArtifactRoot, runCommand } from "./ci-lib";

const artifactRoot = resolveArtifactRoot("solana-program-build-gate");
const anchorRoot = path.join(process.cwd(), "packages/hyperbet-solana/anchor");
const buildLogPath = path.join(artifactRoot, "anchor-build.log");
const trackedArtifactPaths = [
  "packages/hyperbet-solana/anchor/target/deploy",
  "packages/hyperbet-solana/anchor/target/idl",
  "packages/hyperbet-solana/app/src/idl",
  "packages/hyperbet-solana/keeper/src/idl",
];

function currentGitStatus(paths: string[]): string {
  const result = spawnSync("git", ["status", "--short", "--", ...paths], {
    cwd: process.cwd(),
    encoding: "utf8",
  });

  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || "failed to inspect generated artifact status");
  }

  return result.stdout.trim();
}

try {
  await runCommand("bun", ["run", "--cwd", anchorRoot, "build"], {
    stdoutFile: buildLogPath,
    stderrFile: buildLogPath,
  });

  const artifactStatus = currentGitStatus(trackedArtifactPaths);
  if (artifactStatus) {
    throw new Error(
      [
        "Solana build generated tracked artifact drift.",
        "Commit the updated Solana build artifacts before CI runtime gates consume them.",
        artifactStatus,
      ].join("\n"),
    );
  }
} finally {
  copyIntoArtifacts(artifactRoot, buildLogPath, "anchor-build.log");
}
