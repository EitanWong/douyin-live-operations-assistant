// Selected Lucide SVG paths. Provenance and license: vendor/lucide/.
const UI_ICONS = {
  "chart-no-axes-combined": "<path d=\"M12 16v5\" /><path d=\"M16 14.639V21\" /><path d=\"M20 10.656V21\" /><path d=\"m22 3-8.646 8.646a.5.5 0 0 1-.708 0L9.354 8.354a.5.5 0 0 0-.707 0L2 15\" /><path d=\"M4 18.463V21\" /><path d=\"M8 14.656V21\" />",
  "swords": "<path d=\"m13 19 6-6\" /><path d=\"M14.5 17.5 3.586 6.586A2 2 0 013 5.172V3h2.172a2 2 0 011.414.586L17.5 14.5\" /><path d=\"m14.828 6.172 2.586-2.586A2 2 0 0118.828 3H21v2.172a2 2 0 01-.586 1.414l-2.586 2.586\" /><path d=\"m16 16 4 4\" /><path d=\"m19 21 2-2\" /><path d=\"m5 14 4 4\" /><path d=\"m5 21-2-2\" /><path d=\"M7.5 16.5 4 20\" />",
  "gift": "<path d=\"M12 7v14\" /><path d=\"M20 11v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8\" /><path d=\"M7.5 7a1 1 0 0 1 0-5A4.8 8 0 0 1 12 7a4.8 8 0 0 1 4.5-5 1 1 0 0 1 0 5\" /><rect x=\"3\" y=\"7\" width=\"18\" height=\"4\" rx=\"1\" />",
  "hand": "<path d=\"M18 11V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2\" /><path d=\"M14 10V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v2\" /><path d=\"M10 10.5V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2v8\" /><path d=\"M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15\" />",
  "heart": "<path d=\"M2 9.5a5.5 5.5 0 0 1 9.591-3.676.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5c0 2.29-1.5 4-3 5.5l-5.492 5.313a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5\" />",
  "messages-square": "<path d=\"M16 10a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 14.286V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z\" /><path d=\"M20 9a2 2 0 0 1 2 2v10.286a.71.71 0 0 1-1.212.502l-2.202-2.202A2 2 0 0 0 17.172 19H10a2 2 0 0 1-2-2v-1\" />",
  "bot": "<path d=\"M12 8V4H8\" /><rect width=\"16\" height=\"12\" x=\"4\" y=\"8\" rx=\"2\" /><path d=\"M2 14h2\" /><path d=\"M20 14h2\" /><path d=\"M15 13v2\" /><path d=\"M9 13v2\" />",
  "timer": "<line x1=\"10\" x2=\"14\" y1=\"2\" y2=\"2\" /><line x1=\"12\" x2=\"15\" y1=\"14\" y2=\"11\" /><circle cx=\"12\" cy=\"14\" r=\"8\" />",
  "sliders-horizontal": "<path d=\"M10 5H3\" /><path d=\"M12 19H3\" /><path d=\"M14 3v4\" /><path d=\"M16 17v4\" /><path d=\"M21 12h-9\" /><path d=\"M21 19h-5\" /><path d=\"M21 5h-7\" /><path d=\"M8 10v4\" /><path d=\"M8 12H3\" />",
  "palette": "<path d=\"M12 22a1 1 0 0 1 0-20 10 9 0 0 1 10 9 5 5 0 0 1-5 5h-2.25a1.75 1.75 0 0 0-1.4 2.8l.3.4a1.75 1.75 0 0 1-1.4 2.8z\" /><circle cx=\"13.5\" cy=\"6.5\" r=\".5\" fill=\"currentColor\" /><circle cx=\"17.5\" cy=\"10.5\" r=\".5\" fill=\"currentColor\" /><circle cx=\"6.5\" cy=\"12.5\" r=\".5\" fill=\"currentColor\" /><circle cx=\"8.5\" cy=\"7.5\" r=\".5\" fill=\"currentColor\" />",
  "sparkles": "<path d=\"M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z\" /><path d=\"M20 2v4\" /><path d=\"M22 4h-4\" /><circle cx=\"4\" cy=\"20\" r=\"2\" />",
  "play": "<path d=\"M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z\" />",
  "users-round": "<path d=\"M18 21a8 8 0 0 0-16 0\" /><circle cx=\"10\" cy=\"8\" r=\"5\" /><path d=\"M22 20c0-3.37-2-6.5-4-8a5 5 0 0 0-.45-8.3\" />",
  "activity": "<path d=\"M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2\" />",
  "panel-left": "<rect width=\"18\" height=\"18\" x=\"3\" y=\"3\" rx=\"2\" /><path d=\"M9 3v18\" />",
  "panel-right": "<rect width=\"18\" height=\"18\" x=\"3\" y=\"3\" rx=\"2\" /><path d=\"M15 3v18\" />",
  "radio": "<path d=\"M16.247 7.761a6 6 0 0 1 0 8.478\" /><path d=\"M19.075 4.933a10 10 0 0 1 0 14.134\" /><path d=\"M4.925 19.067a10 10 0 0 1 0-14.134\" /><path d=\"M7.753 16.239a6 6 0 0 1 0-8.478\" /><circle cx=\"12\" cy=\"12\" r=\"2\" />",
  "x": "<path d=\"M18 6 6 18\" /><path d=\"m6 6 12 12\" />",
  "save": "<path d=\"M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z\" /><path d=\"M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7\" /><path d=\"M7 3v4a1 1 0 0 0 1 1h7\" />",
  "square": "<rect width=\"18\" height=\"18\" x=\"3\" y=\"3\" rx=\"2\" />"
};

export function icon(name, className = '') {
  if (!Object.hasOwn(UI_ICONS, name)) return '';
  return `<svg class="ui-icon ${className}" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${UI_ICONS[name]}</svg>`;
}

// Buttons retain one label node so live status updates never remove their icon.
export function decorateActionIcons(root) {
  const actionIcons = {save:'save',start:'play',stop:'square',close:'x'};
  for (const [action, name] of Object.entries(actionIcons)) {
    for (const button of root.querySelectorAll(`[data-action="${action}"]`)) {
      if (button.querySelector('[data-button-label]')) continue;
      const label = button.ownerDocument.createElement('span');
      label.dataset.buttonLabel = '';
      label.textContent = button.textContent;
      button.replaceChildren(label);
      button.insertAdjacentHTML('afterbegin', icon(name));
      button.classList.add('icon-button');
    }
  }
}
