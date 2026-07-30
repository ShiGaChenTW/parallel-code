/**
 * Minimal ambient declarations for the Huly client packages.
 *
 * Their package.json files point `types` at `types/index.d.ts`, but that
 * directory is not in the published tarball — a packaging bug on their side, at
 * 0.7.423. Without this the modules resolve as implicit `any`, which this
 * project forbids (`strict` plus `no-explicit-any`).
 *
 * Declared here is only the surface electron/ipc/huly.ts actually uses. It is
 * deliberately narrow: a wider guess would be a fiction, and a fiction that
 * type-checks is worse than a missing type. Extend it when the code needs more,
 * and delete it once upstream ships its declarations.
 */

declare module '@hcengineering/api-client' {
  export interface ConnectOptions {
    token?: string;
    email?: string;
    password?: string;
    workspace: string;
    socketFactory?: unknown;
    connectionTimeout?: number;
  }

  export interface PlatformClient {
    findAll(cls: unknown, query: unknown, options?: unknown): Promise<unknown[]>;
    findOne(cls: unknown, query: unknown, options?: unknown): Promise<unknown>;
    close(): Promise<void>;
  }

  export const NodeWebSocketFactory: unknown;
  export function connect(url: string, options: ConnectOptions): Promise<PlatformClient>;
}

declare module '@hcengineering/core' {
  export const SortingOrder: { Ascending: number; Descending: number };
}

declare module '@hcengineering/tracker' {
  const tracker: {
    class: {
      Project: unknown;
      Issue: unknown;
      Milestone: unknown;
    };
  };
  export default tracker;
}
