import { Show, createSignal, onMount } from 'solid-js';
import { store } from '../store/store';
import {
  clearHulyCredentials,
  hasHulyCredentials,
  saveHulyCredentials,
  setHulyProjectIdentifier,
  testHulyConnection,
} from '../store/huly';
import { tr } from '../store/i18n';
import { theme } from '../lib/theme';
import { errMessage } from '../lib/log';

/**
 * Huly connection settings.
 *
 * The token is write-only from the UI's point of view: it is sent to the main
 * process, encrypted with the OS keychain and never read back for display.
 * Showing a stored credential buys nothing and puts it on screen.
 */
export function HulySettings() {
  const [url, setUrl] = createSignal('');
  const [workspace, setWorkspace] = createSignal('');
  const [token, setToken] = createSignal('');
  const [stored, setStored] = createSignal(false);
  const [status, setStatus] = createSignal('');
  const [busy, setBusy] = createSignal(false);

  onMount(() => {
    void hasHulyCredentials()
      .then(setStored)
      .catch(() => setStored(false));
  });

  const inputStyle = {
    background: theme.bgInput,
    border: `1px solid ${theme.border}`,
    'border-radius': '8px',
    padding: '8px 12px',
    color: theme.fg,
    'font-size': '13px',
    outline: 'none',
    width: '100%',
  } as const;

  const save = async () => {
    setBusy(true);
    setStatus('');
    try {
      await saveHulyCredentials(url(), workspace(), token());
      // Held only long enough to send. Keeping it in a signal would leave the
      // token in renderer memory for the life of the window.
      setToken('');
      setStored(true);
      const result = await testHulyConnection();
      setStatus(
        result.projects.length > 0
          ? `${tr('Connected.')} ${result.projects.join(', ')}`
          : tr('Connected.'),
      );
    } catch (err) {
      setStatus(errMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    setBusy(true);
    try {
      await clearHulyCredentials();
      setStored(false);
      setStatus('');
    } catch (err) {
      setStatus(errMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: 'flex', 'flex-direction': 'column', gap: '8px' }}>
      <Show when={!stored()}>
        <input
          class="input-field"
          type="text"
          value={url()}
          onInput={(e) => setUrl(e.currentTarget.value)}
          placeholder={tr('Server URL')}
          style={inputStyle}
        />
        <input
          class="input-field"
          type="text"
          value={workspace()}
          onInput={(e) => setWorkspace(e.currentTarget.value)}
          placeholder="Workspace"
          style={inputStyle}
        />
        <input
          class="input-field"
          type="password"
          value={token()}
          onInput={(e) => setToken(e.currentTarget.value)}
          placeholder="Token"
          style={inputStyle}
        />
      </Show>

      <input
        class="input-field"
        type="text"
        value={store.hulyProjectIdentifier}
        onInput={(e) => setHulyProjectIdentifier(e.currentTarget.value)}
        placeholder={tr('Huly project')}
        style={inputStyle}
      />

      <div style={{ display: 'flex', gap: '8px' }}>
        <Show
          when={stored()}
          fallback={
            <button
              type="button"
              disabled={busy()}
              onClick={() => void save()}
              style={{
                background: theme.accent,
                border: 'none',
                'border-radius': '8px',
                color: theme.bg,
                cursor: busy() ? 'default' : 'pointer',
                padding: '8px 14px',
                'font-size': '13px',
                'font-weight': '600',
              }}
            >
              {tr('Test connection')}
            </button>
          }
        >
          <button
            type="button"
            disabled={busy()}
            onClick={() => void clear()}
            style={{
              background: theme.bgInput,
              border: `1px solid ${theme.border}`,
              'border-radius': '8px',
              color: theme.fgMuted,
              cursor: busy() ? 'default' : 'pointer',
              padding: '8px 14px',
              'font-size': '13px',
            }}
          >
            {tr('Clear credentials')}
          </button>
        </Show>
      </div>

      <Show when={status()}>
        <div style={{ 'font-size': '12px', color: theme.fgSubtle }}>{status()}</div>
      </Show>
    </div>
  );
}
