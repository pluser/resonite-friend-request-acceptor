import { createServer, type Server } from "http";

export interface HealthCheck {
  name: string;
  check: () => boolean;
}

export interface HealthStatus {
  status: "ok" | "degraded";
  uptime: number;
  checks: Record<string, boolean>;
}

/**
 * Lightweight HTTP server that exposes a `/healthz` endpoint.
 * Returns 200 when all registered checks pass, 503 otherwise.
 */
export class HealthServer {
  private server: Server | undefined;
  private checks: HealthCheck[] = [];
  private startTime = Date.now();

  /**
   * Register a named health check function.
   */
  addCheck(name: string, check: () => boolean): void {
    this.checks.push({ name, check });
  }

  /**
   * Evaluate all checks and build the status response.
   */
  getStatus(): HealthStatus {
    const results: Record<string, boolean> = {};
    let allHealthy = true;

    for (const { name, check } of this.checks) {
      try {
        const healthy = check();
        results[name] = healthy;
        if (!healthy) allHealthy = false;
      } catch {
        results[name] = false;
        allHealthy = false;
      }
    }

    return {
      status: allHealthy ? "ok" : "degraded",
      uptime: Math.floor((Date.now() - this.startTime) / 1000),
      checks: results,
    };
  }

  /**
   * Start the HTTP health server on the given port.
   */
  async start(port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = createServer((req, res) => {
        if (req.url === "/healthz" && req.method === "GET") {
          const status = this.getStatus();
          const code = status.status === "ok" ? 200 : 503;

          res.writeHead(code, { "Content-Type": "application/json" });
          res.end(JSON.stringify(status));
        } else {
          res.writeHead(404, { "Content-Type": "text/plain" });
          res.end("Not Found");
        }
      });

      this.server.on("error", reject);
      this.server.listen(port, () => {
        console.log(`[Health] Listening on port ${port}`);
        resolve();
      });
    });
  }

  /**
   * Stop the HTTP health server.
   */
  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.server) {
        resolve();
        return;
      }
      this.server.close(() => {
        console.log("[Health] Server stopped");
        resolve();
      });
    });
  }
}
