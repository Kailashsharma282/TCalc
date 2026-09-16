import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import ignore from "ignore";
import { DEFAULT_FILE_SIZE_CONFIG } from "@wma/core";

export interface IgnoreResult {
  ignored: boolean;
  reason?: string;
}

export interface IgnoreResolverOptions {
  additionalIgnoreFiles?: string[];
  userExcludePatterns?: string[];
  maxFileSizeBytes?: number;
  onWarning?: (warning: string) => void;
}

const IGNORE_FILE_NAMES = [
  ".gitignore",
  ".cursorignore",
  ".aiderignore",
  ".continueignore",
  ".tcalcignore",
];

export class IgnoreResolver {
  private ig = ignore();

  constructor(private options: IgnoreResolverOptions = {}) {}

  async loadIgnoreFiles(rootPath: string): Promise<void> {
    const files = [...IGNORE_FILE_NAMES, ...(this.options.additionalIgnoreFiles ?? [])];
    // Canonical root for symlink containment (falls back if root is missing).
    const canonicalRoot = await realpath(rootPath).catch(() => path.resolve(rootPath));
    for (const fileName of files) {
      if (path.isAbsolute(fileName) || fileName.split(/[\\/]/).includes("..")) {
        this.options.onWarning?.(`Skipped ignore file outside workspace: ${fileName}`);
        continue;
      }
      const candidate = path.join(rootPath, fileName);
      // Resolve symlinks and verify the real target stays inside the workspace.
      // Missing files preserve existing silent ENOENT handling.
      try {
        const resolvedCandidate = await realpath(candidate);
        const relative = path.relative(canonicalRoot, resolvedCandidate);
        if (path.isAbsolute(relative) || relative === ".." || relative.startsWith(`..${path.sep}`) || relative.startsWith("../")) {
          this.options.onWarning?.(`Skipped ignore file outside workspace: ${fileName}`);
          continue;
        }
        try {
          const content = await readFile(resolvedCandidate, "utf-8");
          this.ig.add(content);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
            this.options.onWarning?.(`Failed to read ignore file ${fileName}: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        this.options.onWarning?.(`Failed to read ignore file ${fileName}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (this.options.userExcludePatterns) {
      this.ig.add(this.options.userExcludePatterns);
    }
  }

  shouldIgnore(relativePath: string, sizeBytes: number): IgnoreResult {
    const maxSize = this.options.maxFileSizeBytes ?? DEFAULT_FILE_SIZE_CONFIG.maxScanFileBytes;
    if (sizeBytes > maxSize) {
      return { ignored: true, reason: `exceeds max file size (${(sizeBytes / 1_000_000).toFixed(1)}MB)` };
    }
    if (this.ig.ignores(relativePath)) {
      return { ignored: true, reason: "matches ignore pattern" };
    }
    return { ignored: false };
  }
}
