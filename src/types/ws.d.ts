declare module 'ws' {
  import type { IncomingMessage } from 'node:http'
  import { EventEmitter } from 'node:events'

  export const OPEN: number

  export class WebSocket {
    readonly readyState: number
    send(data: any): void
    close(): void
    on(event: string, listener: (...args: any[]) => void): this
    once(event: string, listener: (...args: any[]) => void): this
  }

  export interface WebSocketServerOptions {
    noServer?: boolean
  }

  export class WebSocketServer extends EventEmitter {
    constructor(options?: WebSocketServerOptions)
    on(event: 'connection', listener: (ws: WebSocket, req: IncomingMessage) => void): void
    handleUpgrade(
      req: IncomingMessage,
      socket: any,
      head: Buffer,
      cb: (ws: WebSocket, request: IncomingMessage) => void
    ): void
  }
}
