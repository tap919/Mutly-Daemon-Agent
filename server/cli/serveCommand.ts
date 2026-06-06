/**
 * `mutly serve` — start the Mutly HTTP server.
 *
 * This is the same Express server from the existing server.ts entry.
 * In headless mode, it starts in the foreground.
 */
import type { Subcommand, CliContext } from "./types.js";

export const serveCommand: Subcommand = {
  name: "serve",
  summary: "Start the Mutly HTTP server",

  async run(args: string[], ctx: CliContext): Promise<number> {
    const portArg = args.find((a) => a.startsWith("--port="));
    const port = portArg ? parseInt(portArg.split("=")[1], 10) : 3000;

    ctx.log.info(`Starting Mutly server on port ${port}...`);

    // Defer to the existing server module
    // We need to set environment vars before importing server.ts
    // because it reads process.env.PORT at module load time.
    process.env.PORT = String(port);

    try {
      // Dynamic require to avoid tsc needing the server.ts at compile time.
      const mod = await import("../../server.js");
      // server.ts calls startServer(); we just need to import it to trigger.
      if (typeof (mod as any).startServer === "function") {
        (mod as any).startServer();
      }
      // If import returns the running server, it won't resolve until shutdown.
      // Keep the process alive.
      return new Promise(() => {
        // never resolves — keep running until killed
      });
    } catch (e) {
      ctx.log.error(`Server failed to start: ${e instanceof Error ? e.message : String(e)}`);
      return 3;
    }
  },
};
