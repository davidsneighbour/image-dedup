/** Inline CSS for the static report — no external stylesheets or fonts (PLAN.md §31). */
export const REPORT_STYLES = `
:root {
  color-scheme: light;
  --bg: #f5f6f8;
  --panel: #ffffff;
  --border: #d9dde3;
  --text: #1c2126;
  --muted: #5b6470;
  --accent: #2f6fed;
  --ok: #1a7f37;
  --warn: #9a6700;
  --danger: #b3261e;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  background: var(--bg);
  color: var(--text);
}
header {
  padding: 16px 24px;
  background: var(--panel);
  border-bottom: 1px solid var(--border);
}
header h1 { margin: 0 0 4px; font-size: 1.25rem; }
#summary-generated { color: var(--muted); font-size: 0.85rem; }
.layout {
  display: grid;
  grid-template-columns: 360px 1fr;
  min-height: calc(100vh - 70px);
}
.sidebar {
  border-right: 1px solid var(--border);
  background: var(--panel);
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.filters {
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.filters label { font-size: 0.8rem; color: var(--muted); display: flex; flex-direction: column; gap: 2px; }
#group-count { font-size: 0.8rem; color: var(--muted); }
#group-list { overflow-y: auto; flex: 1; padding: 8px; display: flex; flex-direction: column; gap: 6px; }
.group-item {
  display: block;
  width: 100%;
  text-align: left;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 8px 10px;
  cursor: pointer;
  font: inherit;
  color: inherit;
}
.group-item.selected { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
.group-item-title { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-weight: 600; font-size: 0.85rem; }
.group-item-meta { color: var(--muted); font-size: 0.78rem; margin-top: 2px; }
.group-item-decision { color: var(--accent); font-size: 0.75rem; margin-top: 2px; }
.badge {
  font-size: 0.7rem;
  padding: 1px 6px;
  border-radius: 999px;
  border: 1px solid var(--border);
  white-space: nowrap;
}
.badge-automatic { color: var(--ok); border-color: var(--ok); }
.badge-manual-review { color: var(--warn); border-color: var(--warn); }
.badge-ambiguous { color: var(--danger); border-color: var(--danger); }
.badge-approved { color: var(--ok); border-color: var(--ok); }
.badge-rejected { color: var(--danger); border-color: var(--danger); }
main#group-detail { padding: 24px; overflow-y: auto; }
.empty-state { color: var(--muted); }
.group-summary { color: var(--muted); }
.reasons li { color: var(--ok); }
.warnings li { color: var(--warn); }
.members-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 12px;
  margin: 16px 0;
}
.member-card {
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 10px;
  background: var(--panel);
}
.member-card.recommended { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
.member-card img { width: 100%; height: 160px; object-fit: contain; background: repeating-conic-gradient(#e6e6e6 0% 25%, #ffffff 0% 50%) 50% / 16px 16px; border-radius: 4px; }
.member-path { font-size: 0.8rem; word-break: break-all; margin-top: 6px; }
.member-stats, .member-flags { font-size: 0.72rem; color: var(--muted); margin-top: 4px; }
.crop-row { display: flex; gap: 6px; margin-top: 6px; }
.crop-row img { width: 50%; height: 80px; object-fit: cover; border-radius: 4px; }
.btn {
  border: 1px solid var(--border);
  background: var(--panel);
  border-radius: 6px;
  padding: 6px 12px;
  font: inherit;
  cursor: pointer;
}
.btn-primary { background: var(--accent); color: #fff; border-color: var(--accent); }
.btn-small { font-size: 0.72rem; padding: 4px 8px; margin-top: 8px; width: 100%; }
.actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 12px; }
.note-label { display: block; margin-top: 12px; font-size: 0.8rem; color: var(--muted); }
.note-input { display: block; width: 100%; max-width: 480px; min-height: 60px; margin-top: 4px; font: inherit; padding: 6px; border: 1px solid var(--border); border-radius: 6px; }
.current-decision { margin-top: 10px; font-size: 0.85rem; color: var(--accent); }
#export-decisions { margin-left: auto; }
.filters-row { display: flex; align-items: center; gap: 8px; }
`;
