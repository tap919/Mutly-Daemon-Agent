import { execSync } from "child_process";
import { SandboxCommandOutput, SandboxCommandOutputSchema } from "../schemas/agentContracts.js";
import { logger, startTimer } from "../lib/logger.js";
import { SecretManager } from "../lib/secretsManager.js";

export interface ContainerSandboxConfig {
  baseImage: string;
  memoryLimit?: string; // e.g., "512m"
  cpuLimit?: string; // e.g., "0.5"
  pidsLimit?: number;
  readOnlyRootfs?: boolean;
  networkDisabled?: boolean;
}

export class PodmanSandbox {
  private config: Required<ContainerSandboxConfig>;
  private podmanAvailable: boolean | null = null;

  constructor(config: ContainerSandboxConfig, private secretsManager: SecretManager) {
    this.config = {
      baseImage: config.baseImage,
      memoryLimit: config.memoryLimit ?? "512m",
      cpuLimit: config.cpuLimit ?? "0.5",
      pidsLimit: config.pidsLimit ?? 100,
      readOnlyRootfs: config.readOnlyRootfs ?? true,
      networkDisabled: config.networkDisabled ?? true,
    };
  }

  /**
   * Validates that the base image is pinned to a digest, not a tag.
   * Throws if the image reference doesn't contain a digest.
   */
  private validateImagePin(): void {
    if (!this.config.baseImage.includes("@sha256:")) {
      throw new Error(
        `Security policy violation: base image must be pinned to a digest (e.g., alpine@sha256:...), got: ${this.config.baseImage}`
      );
    }
  }

  /**
   * Check if Podman is available by running `podman --version`
   */
  private async checkPodmanAvailable(): Promise<boolean> {
    if (this.podmanAvailable !== null) {
      return this.podmanAvailable;
    }
    try {
      execSync("podman --version", { stdio: "ignore", timeout: 5000 });
      this.podmanAvailable = true;
    } catch {
      this.podmanAvailable = false;
    }
    return this.podmanAvailable;
  }

  /**
   * Runs a command in an ephemeral Podman container with security hardening.
   */
  async runCommand(command: string, options: { workspacePath: string; workDir?: string; timeoutMs?: number } = { workspacePath: process.cwd() }): Promise<SandboxCommandOutput> {
    this.validateImagePin();

    const available = await this.checkPodmanAvailable();
    if (!available) {
      // Return a structured error instead of throwing
      return SandboxCommandOutputSchema.parse({
        exitCode: -1,
        stdout: "",
        stderr: "Podman is not available. Please install Podman or configure a different sandbox backend.",
        duration_ms: 0,
      });
    }

    const timer = startTimer();
    const containerName = `mutly-sandbox-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const workDir = options.workDir ?? "/workspace";
    const timeoutMs = options.timeoutMs ?? 60_000;

    // Build podman run arguments
    const args = [
      "run",
      "--rm", // Remove container after exit
      "--name", containerName,
      "--memory", this.config.memoryLimit,
      "--cpus", this.config.cpuLimit,
      "--pids-limit", String(this.config.pidsLimit),
      "--workdir", workDir,
    ];

    if (this.config.readOnlyRootfs) {
      args.push("--read-only");
      // Add a tmpfs for /tmp so commands can write temp files
      args.push("--tmpfs", "/tmp:rw,noexec,nosuid,size=64m");
    }

    if (this.config.networkDisabled) {
      args.push("--network", "none");
    }

    // Security: drop all capabilities, run as non-root
    args.push("--cap-drop", "ALL");
    args.push("--user", "1000:1000"); // Non-root user

    // Volume mount: mount the workspace read-write so commands can modify files
    // The host path is options.workspacePath, container path is workDir
    args.push("-v", `${options.workspacePath}:${workDir}:rw`);

    args.push(this.config.baseImage);
    args.push("sh", "-c", command);

    const podmanCmd = ["podman", ...args].join(" ");

    logger.info({ component: "PodmanSandbox", command: podmanCmd, workspacePath: options.workspacePath }, "Executing sandbox command");

    try {
      const result = execSync(podmanCmd, {
        encoding: "utf-8",
        timeout: timeoutMs,
        maxBuffer: 10 * 1024 * 1024, // 10MB buffer
      });

      const duration_ms = timer.end();

      const output: SandboxCommandOutput = {
        exitCode: 0,
        stdout: result,
        stderr: "",
        duration_ms,
      };

      logger.info(
        { component: "PodmanSandbox", duration_ms, exitCode: output.exitCode },
        "Sandbox command completed successfully"
      );

      return SandboxCommandOutputSchema.parse(output);
    } catch (error: any) {
      const duration_ms = timer.end();

      // execSync throws on non-zero exit, but we can capture stdout/stderr from the error
      const stdout = error.stdout?.toString() ?? "";
      const stderr = error.stderr?.toString() ?? error.message ?? "Unknown error";
      const exitCode = error.status ?? 1;

      const output: SandboxCommandOutput = {
        exitCode,
        stdout,
        stderr,
        duration_ms,
      };

      logger.warn(
        { component: "PodmanSandbox", duration_ms, exitCode, stderr },
        "Sandbox command failed"
      );

      return SandboxCommandOutputSchema.parse(output);
    }
  }

  /**
   * Pulls the base image if not present locally.
   * In production, this should be handled by a pre-warm step or CI.
   */
  async ensureImage(): Promise<void> {
    const available = await this.checkPodmanAvailable();
    if (!available) {
      logger.warn({ component: "PodmanSandbox" }, "Podman not available, skipping image pull");
      return;
    }
    try {
      execSync(`podman image inspect ${this.config.baseImage}`, { stdio: "ignore" });
      logger.debug({ component: "PodmanSandbox", image: this.config.baseImage }, "Image already present");
    } catch {
      logger.info({ component: "PodmanSandbox", image: this.config.baseImage }, "Pulling base image");
      execSync(`podman pull ${this.config.baseImage}`, { stdio: "inherit" });
    }
  }
}

// Default export for easy importing
export default PodmanSandbox;