export const TOOL_API_VERSION = 1;

// Only bundled, maintained definitions enter this registry. This is not a code loader.
export class ToolRegistry {
  constructor(definitions = []) {
    this.definitions = new Map();
    for (const definition of definitions) this.register(definition);
  }
  register(definition) {
    if (!definition || !/^[a-z][a-z0-9-]*$/.test(definition.id) ||
        !/^\d+\.\d+\.\d+$/.test(definition.version) || definition.apiVersion !== TOOL_API_VERSION ||
        typeof definition.mount !== 'function' || !Array.isArray(definition.capabilities) ||
        definition.capabilities.some(name => typeof name !== 'string') ||
        typeof definition.view?.template !== 'function' || typeof definition.view?.update !== 'function' ||
        typeof definition.label !== 'string' || !definition.label || !/^[a-z0-9-]+$/.test(definition.icon)) {
      throw new Error('工具定义或宿主接口版本无效');
    }
    if (this.definitions.has(definition.id)) throw new Error(`工具重复注册：${definition.id}`);
    const actions = Object.keys(definition.view.actions || {});
    if (actions.some(name => !/^[a-z][a-z0-9-]*$/.test(name) || typeof definition.view.actions[name] !== 'function')) throw new Error('工具操作定义无效');
    const entry = Object.freeze({...definition, capabilities:Object.freeze([...new Set(definition.capabilities)]),
      view:Object.freeze({...definition.view, actions:Object.freeze({...definition.view.actions})})});
    this.definitions.set(entry.id, entry);
    return entry;
  }
  get(id) { return this.definitions.get(id); }
  list() { return [...this.definitions.values()]; }
}
