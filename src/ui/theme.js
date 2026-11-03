// Appearance is global to the tool, independent of a room's automation config.
import {APPEARANCE_PREFERENCES,PALETTES,MATERIALS,normalizeAppearance} from './appearance.js';
export {THEME_KEY} from './appearance.js';

export function installTheme({target,select,paletteSelect,materialSelect,onError=()=>{}}) {
  const controllers=[installPreference({target,select,kind:'theme',onError})];
  for(const [kind,control,choices] of [['palette',paletteSelect,PALETTES],['material',materialSelect,MATERIALS]]){
    target.dataset[kind]=APPEARANCE_PREFERENCES[kind].fallback;
    if(!control)continue;
    control.replaceChildren(...choices.map(([value,label])=>new target.ownerDocument.defaultView.Option(label,value)));
    controllers.push(installPreference({target,select:control,kind,onError}));
  }
  return {ready:Promise.all(controllers.map(c=>c.ready)),destroy:()=>controllers.forEach(c=>c.destroy())};
}
function installPreference({ target, select, kind, onError }) {
  const view = target.ownerDocument.defaultView;
  const extensionStorage = view.chrome?.storage;
  const storage = extensionStorage?.local;
  const runtime = view.chrome?.runtime;
  const {key:preferenceKey,fallback}=APPEARANCE_PREFERENCES[kind];
  const messageType=kind==='theme' ? 'theme' : 'appearance';
  let theme = fallback, revision = 0, destroyed = false;
  const apply = value => {
    theme = normalizeAppearance(kind,value);
    target.dataset[kind] = theme;
    select.value = theme;
  };
  apply(theme);

  const onStorage = (changes, area) => {
    if (area !== 'local' || !Object.hasOwn(changes, preferenceKey) || destroyed) return;
    revision++; apply(changes[preferenceKey].newValue);
  };
  const onRuntimeMessage = message => {
    if ((message?.type !== `${messageType}-changed` || messageType==='appearance' && message.kind!==kind) || destroyed) return;
    revision++; apply(message.value);
  };
  const onLocalStorage = event => {
    if ((event.key === preferenceKey || event.key === null) && !destroyed) {
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
        ? await sendThemeMessage(runtime,{type:`${messageType}-get`,kind})
        : storage ? (await storage.get(preferenceKey))[preferenceKey] : view.localStorage.getItem(preferenceKey);
      if (!destroyed && revision === initialRevision) apply(saved);
    } catch { if (!destroyed) onError('无法读取外观偏好，暂时跟随系统。'); }
  })();
  const onChange = async () => {
    const previous = theme, currentRevision = ++revision;
    apply(select.value);
    try {
      if (runtime?.sendMessage) await sendThemeMessage(runtime,{type:`${messageType}-set`,kind,value:theme});
      else if (storage) await storage.set({ [preferenceKey]: theme });
      else view.localStorage.setItem(preferenceKey, theme);
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
