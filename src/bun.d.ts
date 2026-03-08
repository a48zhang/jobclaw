/**
 * Minimal Bun API type declarations for TypeScript.
 * These cover only the subset of the Bun API used in this project.
 */
declare namespace Bun {
  interface Server {
    port: number
    stop(): void
  }

  function serve(options: {
    port?: number
    hostname?: string
    fetch(
      request: Request,
      server: Server
    ): Response | Promise<Response | null | undefined> | null | undefined
    websocket?: unknown
  }): Server
}
