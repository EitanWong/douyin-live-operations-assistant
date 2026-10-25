export const PK_SETTINGS_CSS = `
.pk-broadcast{margin:16px 0 20px;border:1px solid var(--line);border-radius:12px;background:var(--sg-panel)}
.pk-broadcast-summary{display:flex;align-items:center;gap:12px;min-height:76px;padding:16px;color:var(--ink);list-style:none;border-radius:12px}
.pk-broadcast-summary::-webkit-details-marker{display:none}
.pk-broadcast-summary:hover{background:var(--sg-hover)}
.pk-broadcast-summary:focus-visible{outline-offset:-3px}
.pk-broadcast-icon{display:flex;align-items:center;flex-shrink:0;color:var(--muted)}
.pk-broadcast-heading{display:flex;flex:1;flex-direction:column;gap:4px;min-width:0}
.pk-broadcast-title{font-size:13px;font-weight:600;line-height:1.6}
label.pk-broadcast-title,.pk-broadcast-copy label{cursor:pointer}
.pk-broadcast-description{font-size:11px;color:var(--muted);line-height:1.6;overflow-wrap:anywhere;text-wrap:balance}
.pk-broadcast-state{flex-shrink:0;font-size:11px;color:var(--muted);font-weight:500}
.pk-broadcast[data-enabled=true] .pk-broadcast-state{color:var(--sg-success)}
.pk-broadcast-chevron{flex-shrink:0;color:var(--muted);transition:transform 160ms cubic-bezier(.23,1,.32,1)}
.pk-broadcast[open]>.pk-broadcast-summary{border-radius:12px 12px 0 0}
.pk-broadcast[open]>.pk-broadcast-summary .pk-broadcast-chevron{transform:rotate(90deg)}
.pk-broadcast-body{padding:0 16px}
.pk-broadcast-master{display:flex;align-items:center;justify-content:space-between;gap:20px;padding-top:16px;border-top:1px solid var(--line)}
.pk-broadcast-master>div{min-width:0}
.pk-broadcast-master p,.pk-broadcast-copy p{font-size:11px;color:var(--muted);line-height:1.7;margin:4px 0 0;max-width:68ch}
.pk-broadcast-save-hint{font-size:11px;line-height:1.7;margin:8px 0 16px;color:var(--muted)}
.pk-broadcast .switch{width:44px;height:40px;padding:0 3px;display:flex;align-items:center;background:transparent;box-shadow:none}
.pk-broadcast .switch span{position:relative;flex-shrink:0;width:38px;height:24px;background:var(--sg-well);box-shadow:inset 0 0 0 1px var(--line)}
.pk-broadcast .switch span:after{position:relative;top:3px;left:3px}
.pk-broadcast .switch:has(input:disabled){cursor:default}
.pk-broadcast .switch input:disabled{cursor:default}
.pk-broadcast-options:disabled .switch span{opacity:.5}
.pk-broadcast-options{min-width:0;padding:0;margin:0;border:0}
.pk-broadcast-option{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:8px 20px;align-items:center;padding:16px 0;border-top:1px solid var(--line)}
.pk-broadcast-copy{min-width:0}
.pk-broadcast-copy h3{font-size:13px;line-height:1.6;font-weight:600;margin:0}
.pk-broadcast-option>.switch{grid-column:3;grid-row:1}
.pk-broadcast-interval{display:flex;align-items:center;gap:8px;font-size:11px;white-space:nowrap}
.pk-broadcast-number{display:flex;align-items:center;min-width:0;gap:8px;position:relative}
.pk-broadcast-number input{min-width:0;width:88px;min-height:40px;padding:8px 28px 8px 10px;font-size:13px;font-weight:400;font-variant-numeric:tabular-nums;background:var(--sg-well)}
.pk-broadcast-number>span{position:absolute;right:10px;pointer-events:none;font-size:11px;font-weight:400;color:var(--muted)}
.pk-broadcast-number input:disabled{color:var(--muted);cursor:default}
.pk-broadcast-number input::-webkit-inner-spin-button,.pk-broadcast-number input::-webkit-outer-spin-button{-webkit-appearance:none;margin:0}
.pk-broadcast-number input{appearance:textfield;-moz-appearance:textfield}
.pk-broadcast-interval:has(input:disabled){color:var(--muted)}
.pk-broadcast-midnight{grid-column:1/-1;padding-top:8px;min-width:0}
.pk-broadcast-times{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
.pk-broadcast-times .field{margin:0;gap:6px}
.pk-broadcast-times .field>span:first-child{font-size:11px;font-weight:500}
.pk-broadcast-times .pk-broadcast-number input{width:100%}
.pk-broadcast-times .field small{font-size:10px}
.pk-broadcast-plan{margin:16px 0 4px;font-size:12px;line-height:1.8;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
.pk-broadcast-fine-print{font-size:11px;color:var(--muted);line-height:1.7;margin:4px 0 0}
.pk-broadcast-help{border-top:1px solid var(--line);padding:4px 0}
.pk-broadcast-help>summary{font-size:11px;min-height:44px;padding:12px 0}
.pk-broadcast-help p,.pk-broadcast-help ul{font-size:11px;line-height:1.8;color:var(--muted);margin:4px 0 12px;max-width:68ch}
.pk-broadcast-help ul{padding-left:18px}
@container workspace (max-width:620px){
  .pk-broadcast-option{grid-template-columns:minmax(0,1fr) auto;column-gap:12px}
  .pk-broadcast-option>.switch{grid-column:2}
  .pk-broadcast-interval{grid-column:1;grid-row:2}
}
@container workspace (max-width:380px){
  .pk-broadcast-summary{gap:8px;padding:12px}
  .pk-broadcast-body{padding:0 12px}
  .pk-broadcast-icon{display:none}
  .pk-broadcast-times{grid-template-columns:minmax(0,1fr);gap:12px}
  .pk-broadcast-times .field{display:grid;grid-template-columns:minmax(0,1fr) 96px;align-items:center;column-gap:12px}
  .pk-broadcast-times .field small{grid-column:1/-1}
}
@media(forced-colors:active){.pk-broadcast .switch span{border:1px solid ButtonText}.pk-broadcast .switch span:after{background:ButtonText}.pk-broadcast .switch input:checked+span{background:Highlight}}
`;
