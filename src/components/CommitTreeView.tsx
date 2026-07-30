import { For, Show, createMemo, createSignal } from 'solid-js';
import { tr } from '../store/i18n';
import { createStore } from 'solid-js/store';
import { theme } from '../lib/theme';
import { sf } from '../lib/fontScale';
import { invoke } from '../lib/ipc';
import { IPC } from '../../electron/ipc/channels';
import { isCommitHashSelection, type CommitSelection } from './CommitNavBar';
import { CommitFilesPopover, POPOVER_WIDTH, POPOVER_MAX_HEIGHT } from './CommitFilesPopover';
import type { ChangedFile, CommitInfo } from '../ipc/types';

interface CommitTreeViewProps {
  commits: CommitInfo[];
  worktreePath: string;
  baseBranch?: string;
  selectedCommit: CommitSelection;
  onSelectCommit: (hash: string) => void;
}

/**
 * A linear commit graph for the current branch (mergeBase..HEAD). Renders a
 * vertical rail with one node per commit plus a terminal "base" node, mirroring
 * how `git log --graph` reads top-to-bottom. Clicking a commit selects it;
 * hovering reveals the files that commit touched.
 */
export function CommitTreeView(props: CommitTreeViewProps) {
  // getBranchCommits returns oldest→newest (it logs with --reverse); show the
  // newest commit at the top to match conventional `git log` ordering. Memoized
  // so the parent's 5s commit poll doesn't reallocate + re-diff the list each tick.
  const ordered = createMemo(() => [...props.commits].reverse());

  const [hovered, setHovered] = createSignal<{ hash: string; rect: DOMRect } | null>(null);
  const [filesByHash, setFilesByHash] = createStore<Record<string, ChangedFile[]>>({});
  const inFlight = new Set<string>();

  async function ensureFiles(hash: string) {
    if (filesByHash[hash] || inFlight.has(hash)) return;
    inFlight.add(hash);
    try {
      const result = await invoke<ChangedFile[]>(IPC.GetCommitChangedFiles, {
        worktreePath: props.worktreePath,
        commitHash: hash,
      });
      setFilesByHash(hash, result);
    } catch {
      // Leave the key unset (not an empty array) so this stays in the "loading"
      // state and a later hover retries. Caching [] here would pin the commit to
      // "No files touched." forever after a transient failure (e.g. the worktree
      // being momentarily unavailable).
    } finally {
      inFlight.delete(hash);
    }
  }

  function handleEnter(hash: string, e: MouseEvent) {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setHovered({ hash, rect });
    void ensureFiles(hash);
  }

  // Anchor the popover beside the hovered row, flipping/clamping to stay on
  // screen. Recomputed per hover, so a stale viewport size is never an issue.
  const popover = createMemo(() => {
    const h = hovered();
    if (!h) return null;
    const { rect } = h;
    let left = rect.right + 8;
    if (left + POPOVER_WIDTH > window.innerWidth - 8) {
      left = rect.left - POPOVER_WIDTH - 8;
    }
    left = Math.max(8, left);
    const top = Math.max(8, Math.min(rect.top, window.innerHeight - POPOVER_MAX_HEIGHT - 8));
    return { left, top, hash: h.hash };
  });

  return (
    <div style={{ height: '100%', overflow: 'auto', padding: '4px 0' }}>
      <Show
        when={props.commits.length > 0}
        fallback={
          <div style={{ padding: '8px', 'font-size': sf(11), color: theme.fgMuted }}>
            {tr('No commits on this branch yet.')}
          </div>
        }
      >
        <For each={ordered()}>
          {(commit, i) => {
            const isSelected = () =>
              isCommitHashSelection(props.selectedCommit) && props.selectedCommit === commit.hash;
            return (
              <div
                class="commit-tree-row"
                onClick={() => props.onSelectCommit(commit.hash)}
                onMouseEnter={(e) => handleEnter(commit.hash, e)}
                onMouseLeave={() => setHovered(null)}
                title={`${commit.hash.slice(0, 7)} ${commit.message}`}
                style={{
                  display: 'flex',
                  'align-items': 'stretch',
                  cursor: 'pointer',
                  background: isSelected() ? theme.bgHover : 'transparent',
                }}
              >
                <Rail showTop={i() > 0} showBottom={true} accent={isSelected()} />
                <div
                  style={{
                    flex: '1',
                    'min-width': '0',
                    padding: '3px 8px 3px 2px',
                    'font-size': sf(11),
                    'line-height': '1.5',
                    'white-space': 'nowrap',
                    overflow: 'hidden',
                    'text-overflow': 'ellipsis',
                  }}
                >
                  <span
                    style={{
                      color: theme.accent,
                      'font-weight': '600',
                      'font-family': "'JetBrains Mono', monospace",
                    }}
                  >
                    {commit.hash.slice(0, 7)}
                  </span>{' '}
                  <span style={{ color: theme.fg }}>{commit.message}</span>
                </div>
              </div>
            );
          }}
        </For>
        {/* Terminal node marking the merge base the branch grew from. */}
        <div style={{ display: 'flex', 'align-items': 'stretch' }}>
          <Rail showTop={true} showBottom={false} base={true} />
          <div
            style={{
              flex: '1',
              'min-width': '0',
              padding: '3px 8px 3px 2px',
              'font-size': sf(11),
              'line-height': '1.5',
              color: theme.fgMuted,
              'font-family': "'JetBrains Mono', monospace",
              'white-space': 'nowrap',
              overflow: 'hidden',
              'text-overflow': 'ellipsis',
            }}
          >
            {props.baseBranch ?? 'base'} <span style={{ color: theme.fgSubtle }}>(base)</span>
          </div>
        </div>
      </Show>

      <Show when={popover()}>
        {(pos) => <CommitFilesPopover pos={pos()} files={filesByHash[pos().hash]} />}
      </Show>
    </div>
  );
}

interface RailProps {
  showTop: boolean;
  showBottom: boolean;
  accent?: boolean;
  base?: boolean;
}

/**
 * One cell of the commit rail: a centered node with optional line segments above
 * and below. Adjacent rows' segments join into one continuous vertical line.
 */
function Rail(props: RailProps) {
  const segment = (half: 'top' | 'bottom') => (
    <div
      style={{
        position: 'absolute',
        left: '50%',
        top: half === 'top' ? '0' : '50%',
        height: '50%',
        width: '1px',
        background: theme.border,
        transform: 'translateX(-0.5px)',
      }}
    />
  );

  return (
    <div
      style={{ position: 'relative', width: '18px', 'flex-shrink': '0', 'align-self': 'stretch' }}
    >
      <Show when={props.showTop}>{segment('top')}</Show>
      <Show when={props.showBottom}>{segment('bottom')}</Show>
      <div
        style={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          transform: 'translate(-50%, -50%)',
          width: props.base ? '8px' : '7px',
          height: props.base ? '8px' : '7px',
          'border-radius': props.base ? '2px' : '50%',
          background: props.base ? theme.bg : props.accent ? theme.accent : theme.fgMuted,
          border: props.base ? `1px solid ${theme.fgMuted}` : 'none',
          'box-sizing': 'border-box',
        }}
      />
    </div>
  );
}
