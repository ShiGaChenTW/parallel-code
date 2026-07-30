import fs from 'fs';
import path from 'path';
import { app, safeStorage } from 'electron';
import { debug, warn, errMessage } from '../log.js';
import type { HulyIssue } from './shared-types.js';

/**
 * Huly read path: list issues from a Huly project so one can be turned into a
 * task (worktree + agent).
 *
 * Read-only by design. Writing back to Huly is a separate piece of work with a
 * field-ownership model behind it; nothing here mutates a remote document.
 *
 * Confined to the main process. dependency-cruiser forbids the renderer from
 * importing this, and the client needs a Node WebSocket anyway.
 *
 * Version note: this app pins @hcengineering/* 0.7.423 — the newest version
 * published to npm — while a server may run newer (0.7.426 observed). 0.7.426
 * is not published under any dist-tag, so the gap cannot be closed from the
 * client side.
 *
 * Measured effect of the gap: none on behaviour. findAll, findOne, createDoc,
 * addCollection and updateDoc all work against 0.7.426. The only visible symptom
 * is 15 `failed to apply model transaction` warnings per connect, suppressed
 * below. Treat the gap as noise unless something concrete fails.
 *
 * One genuine limitation, unrelated to versions: `uploadMarkup` does not
 * overwrite an existing markup blob. Its ref is derived from
 * (object, field, revision) and storage is write-once, so a new document can be
 * created with a description but an existing one cannot have its description
 * replaced this way. Append a comment instead of rewriting a description.
 */

export type { HulyIssue };

export interface HulyCredentials {
  url: string;
  workspace: string;
  token: string;
}

const CREDENTIALS_FILE = 'huly-credentials.enc';

function credentialsPath(): string {
  return path.join(app.getPath('userData'), CREDENTIALS_FILE);
}

/**
 * Validate a decrypted credentials blob. Exported for tests and because a file
 * on disk is not trusted input — a partially written or hand-edited file must
 * fail closed rather than produce a half-configured connection.
 */
export function parseCredentials(raw: string): HulyCredentials | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const { url, workspace, token } = value as Record<string, unknown>;
  if (typeof url !== 'string' || typeof workspace !== 'string' || typeof token !== 'string') {
    return null;
  }
  // Trim before validating, not after: a pasted URL often carries whitespace,
  // and checking the scheme first would reject it for the wrong reason.
  const trimmed = {
    url: url.trim(),
    workspace: workspace.trim(),
    token: token.trim(),
  };
  if (trimmed.url === '' || trimmed.workspace === '' || trimmed.token === '') return null;
  // Refuse plain http to anywhere but loopback: the token is a bearer credential.
  if (
    !/^https:\/\//i.test(trimmed.url) &&
    !/^http:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/i.test(trimmed.url)
  ) {
    return null;
  }
  return trimmed;
}

/** Map a Huly issue document to the shape this app stores and renders. */
export function mapIssue(doc: {
  _id: unknown;
  identifier?: unknown;
  title?: unknown;
  status?: unknown;
  modifiedOn?: unknown;
}): HulyIssue | null {
  const id = typeof doc._id === 'string' ? doc._id : null;
  const identifier = typeof doc.identifier === 'string' ? doc.identifier : null;
  if (!id || !identifier) return null;
  return {
    id,
    identifier,
    title: typeof doc.title === 'string' ? doc.title : '',
    status: typeof doc.status === 'string' ? doc.status : '',
    modifiedOn: typeof doc.modifiedOn === 'number' ? doc.modifiedOn : 0,
  };
}

export function hasCredentials(): boolean {
  return fs.existsSync(credentialsPath());
}

/**
 * Persist credentials, encrypted by the OS keychain.
 *
 * Throws when encryption is unavailable rather than falling back to plaintext.
 * This is the first credential this app persists at all — the existing Minimax
 * key is memory-only — so there is no precedent for writing one in the clear,
 * and there should not be.
 */
export function saveCredentials(creds: HulyCredentials): void {
  const parsed = parseCredentials(JSON.stringify(creds));
  if (!parsed) throw new Error('Invalid Huly credentials');
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error(
      'OS encryption is unavailable, so the Huly token cannot be stored safely. ' +
        'On Linux this usually means no keyring (gnome-keyring or kwallet) is running.',
    );
  }
  const encrypted = safeStorage.encryptString(JSON.stringify(parsed));
  fs.writeFileSync(credentialsPath(), encrypted, { mode: 0o600 });
  debug('huly', 'credentials stored');
}

export function clearCredentials(): void {
  try {
    fs.unlinkSync(credentialsPath());
  } catch {
    // Already gone is the desired end state.
  }
  closeConnection();
}

export function loadCredentials(): HulyCredentials | null {
  const file = credentialsPath();
  if (!fs.existsSync(file)) return null;
  if (!safeStorage.isEncryptionAvailable()) return null;
  try {
    return parseCredentials(safeStorage.decryptString(fs.readFileSync(file)));
  } catch (err) {
    warn('huly', 'stored credentials could not be decrypted', { error: errMessage(err) });
    return null;
  }
}

// --- connection -------------------------------------------------------------

type HulyClient = {
  findAll: (cls: unknown, query: unknown, options?: unknown) => Promise<unknown[]>;
  findOne: (cls: unknown, query: unknown, options?: unknown) => Promise<unknown>;
  close: () => Promise<void>;
};

let client: HulyClient | null = null;
let connecting: Promise<HulyClient> | null = null;

/** True for the client's own model-transaction noise, and nothing else. */
export function isModelTransactionWarning(first: unknown): boolean {
  return typeof first === 'string' && first.includes('failed to apply model transaction');
}

/** The console surface this suppression touches. Narrow so a test can pass a fake. */
export interface WarnSink {
  warn: (...args: unknown[]) => void;
}

/**
 * Silence the client's model-transaction warnings for the duration of `fn`.
 *
 * The client writes them itself, so there is no logger to configure. Measured
 * at 15 per connect against a 0.7.426 server. They report model transactions
 * referencing documents this client's model does not contain — nothing the user
 * can act on.
 *
 * Takes the sink as a parameter because the first version of this hooked
 * `console.log` and silently did nothing: the client uses `console.warn`. A
 * parameter makes the choice explicit and lets a test assert it.
 */
export async function withSuppressedModelWarnings<T>(
  fn: () => Promise<T>,
  sink: WarnSink = console,
): Promise<T> {
  const original = sink.warn;
  let suppressed = 0;
  sink.warn = (...args: unknown[]) => {
    if (isModelTransactionWarning(args[0])) {
      suppressed++;
      return;
    }
    original(...args);
  };
  try {
    return await fn();
  } finally {
    sink.warn = original;
    if (suppressed > 0) {
      debug('huly', 'suppressed client model-version warnings', { count: suppressed });
    }
  }
}

async function getClient(): Promise<HulyClient> {
  if (client) return client;
  if (connecting) return connecting;

  const creds = loadCredentials();
  if (!creds) throw new Error('Huly is not configured');

  connecting = withSuppressedModelWarnings(async () => {
    // Imported lazily: the @hcengineering packages are several MB and must not
    // be paid for at startup by users who never connect Huly.
    const apiClient = await import('@hcengineering/api-client');
    const { connect, NodeWebSocketFactory } = apiClient.default ?? apiClient;
    const connected = (await connect(creds.url, {
      token: creds.token,
      workspace: creds.workspace,
      socketFactory: NodeWebSocketFactory,
      connectionTimeout: 30_000,
    })) as unknown as HulyClient;
    client = connected;
    debug('huly', 'connected', { workspace: creds.workspace });
    return connected;
  }).finally(() => {
    connecting = null;
  });

  return connecting;
}

export function closeConnection(): void {
  const open = client;
  client = null;
  if (open) void open.close().catch(() => undefined);
}

/**
 * List issues in a Huly project by its identifier (e.g. "FK_PC").
 *
 * Returns newest-modified first and caps the result: this feeds a picker, and
 * an unbounded fetch on a large project would stall the dialog.
 */
export async function listIssues(projectIdentifier: string, limit = 100): Promise<HulyIssue[]> {
  const trackerMod = await import('@hcengineering/tracker');
  const tracker = trackerMod.default ?? trackerMod;
  const coreMod = await import('@hcengineering/core');
  const { SortingOrder } = coreMod;

  const conn = await getClient();
  const project = (await conn.findOne(tracker.class.Project, {
    identifier: projectIdentifier,
  })) as { _id?: unknown } | undefined;
  if (!project?._id) throw new Error(`Huly project not found: ${projectIdentifier}`);

  const docs = await conn.findAll(
    tracker.class.Issue,
    { space: project._id },
    { limit, sort: { modifiedOn: SortingOrder.Descending } },
  );
  return docs
    .map((doc) => mapIssue(doc as Parameters<typeof mapIssue>[0]))
    .filter((issue): issue is HulyIssue => issue !== null);
}

/** Verify credentials by listing projects. Used by the settings UI. */
export async function testConnection(): Promise<{ ok: boolean; projects: string[] }> {
  const trackerMod = await import('@hcengineering/tracker');
  const tracker = trackerMod.default ?? trackerMod;
  const conn = await getClient();
  const projects = (await conn.findAll(tracker.class.Project, {})) as { identifier?: unknown }[];
  return {
    ok: true,
    projects: projects
      .map((p) => p.identifier)
      .filter((id): id is string => typeof id === 'string'),
  };
}
