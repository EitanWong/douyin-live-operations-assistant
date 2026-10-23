// Native disclosures keep keyboard interaction and reading order intact. Width
// changes only choose defaults; an explicit choice wins within each layout.
export class AdaptiveLayout {
  constructor(root) {
    this.root = root;
    this.view = root.host.ownerDocument.defaultView;
    this.choices = new WeakMap();
    this.details = [...root.querySelectorAll('[data-adaptive-details]')];
    this.onClick = event => {
      const summary = event.target.closest('summary');
      const detail = summary?.parentElement;
      if (!detail?.matches('[data-adaptive-details]')) return;
      const choices = this.choices.get(detail) || {};
      choices[this.mode] = !detail.open;
      this.choices.set(detail, choices);
    };
    this.onFocusOut = () => this.view.queueMicrotask(() => this.apply());
    root.addEventListener('click', this.onClick);
    root.addEventListener('focusout', this.onFocusOut);
    const shell = root.querySelector('.workspace-content') || root.querySelector('.floating-panel');
    this.update(shell.getBoundingClientRect().width);
    if (this.view.ResizeObserver) {
      this.observer = new this.view.ResizeObserver(entries => this.update(entries[0].contentRect.width));
      this.observer.observe(shell);
    }
  }
  update(width) {
    if (!width) return; // A closed surface must not reset disclosure choices.
    const mode = width >= 800 ? 'wide' : 'compact';
    if (mode === this.mode) return;
    this.mode = mode;
    this.apply();
  }
  apply() {
    if (!this.mode || this.destroyed) return;
    for (const detail of this.details) {
      const open = this.choices.get(detail)?.[this.mode] ?? this.mode === 'wide';
      // Never remove the field or link the user is currently using.
      if (!open && detail.contains(this.root.activeElement) && this.root.activeElement !== detail.querySelector('summary')) continue;
      detail.open = open;
    }
  }
  destroy() {
    this.destroyed = true;
    this.observer?.disconnect();
    this.root.removeEventListener('click', this.onClick);
    this.root.removeEventListener('focusout', this.onFocusOut);
  }
}
