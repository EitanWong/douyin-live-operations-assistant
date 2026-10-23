// Appearance is global to the tool, independent of a room's automation config.
export const THEME_KEY = 'douyin-live-assistant:theme';
const normalizeTheme = value => ['light', 'dark'].includes(value) ? value : 'system';

export function installTheme({ target, select, onError = () => {} }) {
  const view = target.ownerDocument.defaultView;
  const extensionStorage = view.chrome?.storage;
  const storage = extensionStorage?.local;
  const runtime = view.chrome?.runtime;
  let theme = 'system', revision = 0, destroyed = false;
  const apply = value => {
    theme = normalizeTheme(value);
    target.dataset.theme = theme;
    select.value = theme;
  };
  apply(theme);

  const onStorage = (changes, area) => {
    if (area !== 'local' || !Object.hasOwn(changes, THEME_KEY) || destroyed) return;
    revision++; apply(changes[THEME_KEY].newValue);
  };
  const onRuntimeMessage = message => {
    if (message?.type !== 'theme-changed' || destroyed) return;
    revision++; apply(message.value);
  };
  const onLocalStorage = event => {
    if ((event.key === THEME_KEY || event.key === null) && !destroyed) {
      revision++; apply(event.newValue);
    }
  };
  if (storage) extensionStorage.onChanged?.addListener(onStorage);
  if (runtime?.onMessage?.addListener) runtime.onMessage.addListener(onRuntimeMessage);
  if (!storage && !runtime?.onMessage?.addListener) view.addEventListener('storage', onLocalStorage);

  const ready = (async () => {
    const initialRevision = revision;
    try {
      const saved = runtime?.sendMessage
        ? await sendThemeMessage(runtime,{type:'theme-get'})
        : storage ? (await storage.get(THEME_KEY))[THEME_KEY] : view.localStorage.getItem(THEME_KEY);
      if (!destroyed && revision === initialRevision) apply(saved);
    } catch { if (!destroyed) onError('无法读取外观偏好，暂时跟随系统。'); }
  })();
  const onChange = async () => {
    const previous = theme, currentRevision = ++revision;
    apply(select.value);
    try {
      if (runtime?.sendMessage) await sendThemeMessage(runtime,{type:'theme-set',value:theme});
      else if (storage) await storage.set({ [THEME_KEY]: theme });
      else view.localStorage.setItem(THEME_KEY, theme);
    } catch {
      if (!destroyed && revision === currentRevision) {
        apply(previous);
        onError('外观偏好保存失败，请重新选择。');
      }
    }
  };
  select.addEventListener('change', onChange);
  return {
    ready,
    destroy() {
      destroyed = true;
      select.removeEventListener('change', onChange);
      if (storage) extensionStorage.onChanged?.removeListener(onStorage);
      runtime?.onMessage?.removeListener?.(onRuntimeMessage);
      if (!storage && !runtime?.onMessage?.addListener) view.removeEventListener('storage', onLocalStorage);
    }
  };
}

async function sendThemeMessage(runtime, message) {
  const result = await runtime.sendMessage(message);
  if (!result?.ok) throw new Error(result?.error || '外观偏好读取失败');
  return result.value;
}
