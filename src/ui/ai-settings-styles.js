export const AI_SETTINGS_CSS=`
.scroll:has([data-page="ai"]:not([hidden])){padding-top:0}
[data-page="ai"]{padding-top:20px}
.ai-settings{container:ai-settings / inline-size;min-width:0}
.ai-section-tabs{position:sticky;top:0;z-index:2;display:flex;gap:4px;padding:4px;margin:0 0 18px;border-radius:10px;background:var(--sg-solid)}
.ai-section-tabs button{flex:1;min-width:0;white-space:nowrap;min-height:36px;padding:7px 8px;border:0;box-shadow:none;background:transparent;color:var(--muted);font-size:12px;border-radius:7px}
.ai-section-tabs button[aria-selected=true]{background:var(--sg-solid);color:var(--ink);box-shadow:var(--sg-state-shadow);font-weight:600}
.ai-settings .ai-card{padding:16px;margin:0 0 14px;border-radius:12px;background:var(--sg-panel);box-shadow:var(--sg-pane-shadow);min-width:0}
.ai-card h3{font-size:13px;font-weight:600;margin:0 0 12px}.ai-card .group-note{margin:-3px 0 14px}.ai-card .field{margin-bottom:14px}
.ai-card .grid{column-gap:14px;row-gap:0;align-items:start}.ai-card .grid>*{min-width:0}.ai-card .grid>[hidden]{display:none}
.ai-card .hint{margin:8px 0 0}.ai-card details>summary{padding-block:9px}.ai-card .ai-help{border-top:1px solid var(--line);margin-top:12px;padding-top:3px}
.ai-card-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px}.ai-card-heading h3{margin:0}
.ai-key-actions{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px 14px;margin:-6px 0 8px}.ai-key-actions .toggle{font-size:12px;margin:0}
.ai-test-row{display:flex;align-items:center;flex-wrap:wrap;gap:8px 14px;margin:4px 0 18px}.ai-test-row .hint{margin:0;flex:1;min-width:180px}
.ai-tag{font-size:10px;font-weight:400;color:var(--muted);margin-left:6px}.ai-empty{font-size:12px;color:var(--muted);line-height:1.8;padding:18px;border:1px dashed var(--line);border-radius:12px}
.ai-service-grid{display:grid;grid-template-columns:minmax(0,1fr);gap:0 16px;align-items:start}.ai-media-switches{display:flex;flex-wrap:wrap;gap:0 18px}
@container ai-settings (min-width:760px){.ai-service-grid:has(>[data-text-service]:not([hidden])):has(>[data-pipeline-ali]:not([hidden])){grid-template-columns:repeat(2,minmax(0,1fr))}.ai-service-grid:has(>[data-text-service]:not([hidden])):has(>[data-pipeline-ali]:not([hidden])) .grid{grid-template-columns:minmax(0,1fr)}}
@container ai-settings (max-width:440px){.ai-card .grid{grid-template-columns:minmax(0,1fr)}.ai-section-tabs{gap:2px}.ai-section-tabs button{padding-inline:3px;font-size:11px}.ai-key-actions{align-items:flex-start}.ai-card{overflow-wrap:anywhere}}
`;
