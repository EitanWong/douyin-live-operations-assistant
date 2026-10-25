export const NAVIGATION_CSS = `
.ui-icon{display:inline-block;width:18px;height:18px;flex:0 0 auto;vertical-align:middle;pointer-events:none}
.icon-button{display:inline-flex;align-items:center;justify-content:center;gap:7px}
.icon-button .ui-icon{width:16px;height:16px}
.workspace{display:flex;flex-direction:column;min-height:0;flex:1}
.workspace-content{display:flex;flex-direction:column;min-width:0;min-height:0;flex:1;container:workspace / inline-size}
.nav-group{margin:0;min-width:0}.nav-group-title,.sidebar-heading{display:none}
.subnav button{display:inline-flex;align-items:center;gap:7px}.subnav .ui-icon{width:16px;height:16px}
.workspace[data-nav-layout=sidebar]{flex-direction:row}
.workspace[data-nav-layout=sidebar][data-nav-side=right]{flex-direction:row-reverse}
.workspace[data-nav-layout=sidebar]>.nav{width:172px;flex:0 0 172px;min-height:0;box-sizing:border-box;padding:12px 10px 20px;overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:var(--sg-scroll) transparent;border:0;border-right:1px solid var(--line);background:var(--sg-background)}
.workspace[data-nav-layout=sidebar][data-nav-side=right]>.nav{border-right:0;border-left:1px solid var(--line)}
.workspace[data-nav-layout=sidebar] .primary-nav{display:none}
.workspace[data-nav-layout=sidebar] .sidebar-heading{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:0 2px 8px 8px;font-size:12px;font-weight:600;color:var(--ink)}
.sidebar-heading button{display:grid;place-items:center;width:36px;height:36px;min-height:36px;padding:6px;background:transparent;box-shadow:none;border:0;color:var(--muted)}
.sidebar-heading button:hover{background:var(--sg-control);color:var(--ink)}
.workspace[data-nav-layout=sidebar] .nav-group-title{display:block;margin:16px 10px 8px;font-size:11px;line-height:1.5;font-weight:600;color:var(--muted)}
.workspace[data-nav-layout=sidebar] .subnav{display:flex;flex-direction:column;flex-wrap:nowrap;gap:4px;padding:0;overflow:visible}
.workspace[data-nav-layout=sidebar] .subnav button{justify-content:flex-start;flex-shrink:0;min-height:40px;width:100%;padding:9px 10px;text-align:left;white-space:normal;line-height:1.5;font-size:12px;border-radius:8px;color:var(--muted)}
.workspace[data-nav-layout=sidebar] .subnav button[aria-selected=true]{background:var(--sg-brand-wash);color:var(--sg-brand);font-weight:600;box-shadow:none}
.workspace[data-nav-layout=sidebar] .subnav button:hover:not(:disabled){background:var(--sg-control);color:var(--ink)}
.workspace[data-nav-layout=sidebar] .subnav button[aria-selected=true]:hover{background:var(--sg-brand-wash);color:var(--sg-brand)}
.workspace[data-nav-layout=sidebar][data-nav-side=right] .sidebar-heading{flex-direction:row-reverse;padding:0 8px 8px 2px;text-align:right}
.workspace[data-nav-layout=sidebar][data-nav-side=right] .nav-group-title{text-align:right}
.workspace[data-nav-layout=sidebar][data-nav-side=right] .subnav button{flex-direction:row-reverse;text-align:right}
.workspace[data-nav-layout=sidebar][data-nav-collapsed=true]>.nav{width:56px;flex-basis:56px;padding-inline:6px}
.workspace[data-nav-layout=sidebar][data-nav-collapsed=true] .nav-label{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
.workspace[data-nav-layout=sidebar][data-nav-collapsed=true] .sidebar-heading{justify-content:center;padding-inline:0}
.workspace[data-nav-layout=sidebar][data-nav-collapsed=true] .nav-group-title{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap;margin:0;padding:0}
.workspace[data-nav-layout=sidebar][data-nav-collapsed=true] .nav-group+.nav-group{margin-top:16px;padding-top:12px;border-top:1px solid var(--line)}
.workspace[data-nav-layout=sidebar][data-nav-collapsed=true] .subnav button{justify-content:center;padding-inline:0}
@container assistant (max-width:400px){.workspace[data-nav-layout=top] .subnav .ui-icon{display:none}.foot .icon-button{gap:5px}}
@container assistant (max-height:340px){.workspace,.workspace-content{flex:none;min-height:auto}.workspace[data-nav-layout=sidebar]>.nav{overflow:visible}}
`;
