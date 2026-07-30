import type { KnipConfig } from 'knip';

const config: KnipConfig = {
  entry: ['electron/main.ts', 'electron/preload.cjs', 'electron/mcp/server.ts'],
  project: ['electron/**/*.ts', 'src/**/*.{ts,tsx}'],
  ignore: [
    // Ambient module declarations are never imported — that is what makes them
    // ambient. Needed until @hcengineering ships the types its package.json claims.
    'electron/ipc/hcengineering.d.ts',
  ],
  ignoreBinaries: [
    // Optional security tooling invoked from npm scripts; installed on demand.
    'semgrep',
    'gitleaks',
  ],
  // Test files are allowed to have unused exports (test helpers, fixtures).
  ignoreExportsUsedInFile: true,
};

export default config;
