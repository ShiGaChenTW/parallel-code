import { Show, createSignal, createUniqueId, untrack } from 'solid-js';
import { Dialog } from '../components/Dialog';
import { tr } from '../store/i18n';
import { arenaStore } from './store';
import type { BattleCompetitor } from './types';

interface CommitDialogProps {
  target: BattleCompetitor;
  hasCommitted: boolean;
  onCommitAndMerge: (message: string) => void;
  onDiscardAndMerge: () => void;
  onCancel: () => void;
}

export function CommitDialog(props: CommitDialogProps) {
  const titleId = createUniqueId();
  const promptSnippet = () => {
    const p = arenaStore.prompt;
    return p.slice(0, 50) + (p.length > 50 ? '...' : '');
  };
  // The default commit subject is not translated: it is written into git
  // history rather than shown as UI copy, and commit subjects here are English.
  const [commitMsg, setCommitMsg] = createSignal(
    untrack(() => `arena: ${props.target.name} — ${promptSnippet()}`),
  );

  return (
    <Dialog
      open={true}
      onClose={props.onCancel}
      width="420px"
      labelledBy={titleId}
      panelStyle={{
        background: 'transparent',
        border: 'none',
        'box-shadow': 'none',
        padding: '0',
        overflow: 'visible',
      }}
    >
      <div class="arena-commit-dialog">
        <div id={titleId} class="arena-commit-title">
          {tr('{name} has uncommitted changes', { name: props.target.name })}
        </div>
        <label class="arena-commit-label">
          {tr('Commit message')}
          <input
            class="arena-commit-input"
            type="text"
            value={commitMsg()}
            onInput={(e) => setCommitMsg(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && commitMsg().trim()) props.onCommitAndMerge(commitMsg());
            }}
            autofocus
          />
        </label>
        <div class="arena-commit-actions">
          <button
            class="arena-merge-btn"
            disabled={!commitMsg().trim()}
            onClick={() => props.onCommitAndMerge(commitMsg())}
          >
            {tr('Commit & Merge')}
          </button>
          <Show when={props.hasCommitted}>
            <button class="arena-close-btn" onClick={() => props.onDiscardAndMerge()}>
              {tr('Discard uncommitted & Merge')}
            </button>
          </Show>
          <button class="arena-close-btn" onClick={() => props.onCancel()}>
            {tr('Cancel')}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
