export const cssText = `
.dsh_activity_section {
  display: flex;
  flex-direction: column;
  gap: 18px;
  min-width: 0;
  color: var(--dsw-alias-label-primary);
  font-size: 13px;
}

.dsh_activity_hero {
  display: flex;
  justify-content: space-between;
  gap: 24px;
  align-items: flex-start;
  padding: 4px 0 18px;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
}

.dsh_activity_heroCopy { min-width: 0; }
.dsh_activity_eyebrow {
  display: block;
  margin-bottom: 4px;
  color: var(--dsw-alias-brand-primary);
  font-size: 11px;
  font-weight: 650;
  letter-spacing: .08em;
  line-height: 16px;
  text-transform: uppercase;
}
.dsh_activity_title {
  margin: 0;
  font-size: 24px;
  line-height: 30px;
  font-weight: 700;
  letter-spacing: -.02em;
}
.dsh_activity_heroCopy p { margin: 5px 0 0; color: var(--dsw-alias-label-tertiary); line-height: 20px; }
.dsh_activity_privacy {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  max-width: 360px;
  margin: 4px 0 0;
  color: var(--dsw-alias-label-tertiary);
  font-size: 12px;
  line-height: 18px;
  text-align: right;
}
.dsh_activity_privacyMark,
.dsh_activity_statusMark {
  flex: 0 0 auto;
  width: 7px;
  height: 7px;
  margin-top: 6px;
  border-radius: 50%;
  background: var(--dsw-alias-brand-primary);
}

.dsh_activity_toolbar {
  display: flex;
  align-items: flex-end;
  gap: 12px;
  flex-wrap: wrap;
  padding: 12px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 12px;
  background: var(--dsw-alias-bg-layer-1);
}
.dsh_activity_toolbarGroup { display: flex; align-items: flex-end; gap: 8px; }
.dsh_activity_toolbarRange { flex: 0 0 auto; flex-direction: column; align-items: flex-start; gap: 5px; }
.dsh_activity_toolbarFilters { flex: 1 1 320px; }
.dsh_activity_toolbarFilters select { flex: 1 1 140px; min-width: 0; }
.dsh_activity_toolbarActions { display: flex; gap: 8px; margin-left: auto; }
.dsh_activity_toolbarLabel {
  color: var(--dsw-alias-label-tertiary);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: .03em;
  text-transform: uppercase;
}
.dsh_activity_toolbar select,
.dsh_activity_tableTools select,
.dsh_activity_tableTools input {
  box-sizing: border-box;
  height: 36px;
  min-width: 132px;
  padding: 0 11px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  font: inherit;
}
.dsh_activity_tableTools input { min-width: 210px; }
.dsh_activity_toolbar select:focus-visible,
.dsh_activity_tableTools select:focus-visible,
.dsh_activity_tableTools input:focus-visible,
.dsh_activity_button:focus-visible,
.dsh_activity_ranges button:focus-visible,
.dsh_activity_dimensionTabs button:focus-visible,
.dsh_activity_more:focus-visible,
.dsh_activity_sessionButton:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }

.dsh_activity_ranges { display: flex; padding: 3px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 9px; background: var(--dsw-alias-bg-layer-2); }
.dsh_activity_ranges button,
.dsh_activity_dimensionTabs button { border: 0; background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer; font: inherit; }
.dsh_activity_ranges button { padding: 5px 12px; border-radius: 6px; }
.dsh_activity_ranges button:hover,
.dsh_activity_ranges button.is-active { background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); box-shadow: var(--dsw-shadow-lv1); }
.dsh_activity_button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  height: 36px;
  padding: 0 12px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
  text-decoration: none;
  font: inherit;
  white-space: nowrap;
}
.dsh_activity_button:hover { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.dsh_activity_buttonPrimary { border-color: var(--dsw-alias-brand-primary); background: var(--dsw-alias-brand-primary); color: var(--dsw-alias-label-primary-inverted); }
.dsh_activity_buttonPrimary:hover { background: var(--dsw-alias-button-primary-hover); color: var(--dsw-alias-label-primary-inverted); }

.dsh_activity_status { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; padding: 10px 13px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-tertiary); }
.dsh_activity_statusMain { display: inline-flex; align-items: center; gap: 8px; color: var(--dsw-alias-label-primary); }
.dsh_activity_statusMain .dsh_activity_statusMark { margin: 0; background: var(--dsw-alias-state-success-primary); }
.dsh_activity_statusMeta { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
.dsh_activity_status.is-backfilling .dsh_activity_statusMark { background: var(--dsw-alias-state-warn-primary); }
.dsh_activity_status.is-degraded .dsh_activity_statusMark,
.dsh_activity_status.is-disposed .dsh_activity_statusMark { background: var(--dsw-alias-state-error-primary); }

.dsh_activity_cards,
.dsh_activity_performance { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; }
.dsh_activity_card { display: flex; flex-direction: column; gap: 5px; min-height: 78px; padding: 14px 15px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 11px; background: var(--dsw-alias-bg-layer-1); }
.dsh_activity_card > span { color: var(--dsw-alias-label-tertiary); font-size: 12px; }
.dsh_activity_card > strong { font-size: 22px; line-height: 28px; font-weight: 650; font-variant-numeric: tabular-nums; }
.dsh_activity_card > small { color: var(--dsw-alias-label-tertiary); font-variant-numeric: tabular-nums; }

.dsh_activity_panel { position: relative; min-width: 0; padding: 17px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 12px; background: var(--dsw-alias-bg-layer-1); }
.dsh_activity_panel h3 { margin: 0; font-size: 15px; }
.dsh_activity_panelHeading { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; }
.dsh_activity_panelHeading p { margin: 4px 0 0; color: var(--dsw-alias-label-tertiary); font-size: 12px; }
.dsh_activity_toggle { display: flex; gap: 2px; padding: 2px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; }
.dsh_activity_toggle button { padding: 5px 10px; border: 0; border-radius: 5px; background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer; font: inherit; }
.dsh_activity_toggle button.is-active { background: var(--dsw-alias-bg-layer-3); color: var(--dsw-alias-label-primary); }
.dsh_activity_chartFrame { position: relative; min-height: 300px; margin-top: 12px; }
.dsh_activity_chartScroller { overflow-x: auto; }
.dsh_activity_chartScroller svg { display: block; width: 100%; min-width: 620px; }
.dsh_activity_grid { stroke: var(--dsw-alias-border-l1); stroke-width: 1; }
.dsh_activity_axis { fill: var(--dsw-alias-label-tertiary); font-size: 10px; }
.dsh_activity_tooltip { position: absolute; top: 8px; right: 12px; z-index: 2; display: flex; flex-direction: column; gap: 3px; min-width: 155px; padding: 10px 12px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 9px; background: var(--dsw-alias-bg-layer-3); box-shadow: var(--dsw-shadow-lv2); font-variant-numeric: tabular-nums; }
.dsh_activity_legend { display: flex; justify-content: center; gap: 16px; flex-wrap: wrap; color: var(--dsw-alias-label-secondary); }
.dsh_activity_legend span { display: inline-flex; align-items: center; gap: 6px; }
.dsh_activity_legend i { width: 10px; height: 10px; border-radius: 2px; }

.dsh_activity_dimensionTabs { display: flex; gap: 20px; margin: -2px 0 14px; overflow-x: auto; border-bottom: 1px solid var(--dsw-alias-border-l1); }
.dsh_activity_dimensionTabs button { padding: 8px 2px 9px; border-bottom: 2px solid transparent; white-space: nowrap; }
.dsh_activity_dimensionTabs button.is-active { border-bottom-color: var(--dsw-alias-brand-primary); color: var(--dsw-alias-label-primary); font-weight: 650; }
.dsh_activity_tableTools { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 10px; }
.dsh_activity_tableWrap { min-width: 0; overflow: auto; }
.dsh_activity_table { width: 100%; border-collapse: collapse; white-space: nowrap; }
.dsh_activity_table th { padding: 8px 9px; border-bottom: 1px solid var(--dsw-alias-border-l2); color: var(--dsw-alias-label-tertiary); font-size: 12px; font-weight: 500; text-align: right; }
.dsh_activity_table td { padding: 9px; border-bottom: 1px solid var(--dsw-alias-border-l1); font-variant-numeric: tabular-nums; text-align: right; }
.dsh_activity_table tbody tr:hover td { background: var(--dsw-alias-bg-layer-2); }
.dsh_activity_table th:first-child,
.dsh_activity_table td:first-child { position: sticky; left: 0; z-index: 1; background: var(--dsw-alias-bg-layer-1); text-align: left; }
.dsh_activity_table tbody tr:hover td:first-child { background: var(--dsw-alias-bg-layer-2); }
.dsh_activity_table td:first-child small { display: block; max-width: 260px; overflow: hidden; color: var(--dsw-alias-label-tertiary); text-overflow: ellipsis; }
.dsh_activity_sessionButton { padding: 0; border: 0; background: transparent; color: var(--dsw-alias-brand-primary); cursor: pointer; font: inherit; }
.dsh_activity_sessionButton:hover { text-decoration: underline; }

.dsh_activity_loadingOverlay { padding: 10px; color: var(--dsw-alias-label-tertiary); text-align: center; }
.dsh_activity_more { display: block; margin: 12px auto 0; border: 0; background: transparent; color: var(--dsw-alias-brand-primary); cursor: pointer; font: inherit; }
.dsh_activity_empty { padding: 30px; color: var(--dsw-alias-label-tertiary); text-align: center; }
.dsh_activity_error { padding: 10px 12px; border: 1px solid var(--dsw-alias-state-error-secondary); border-radius: 8px; background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-state-error-primary); }
.dsh_activity_outcomes { display: flex; align-items: center; gap: 9px; flex-wrap: wrap; margin-top: 13px; }
.dsh_activity_outcomes span { padding: 3px 8px; border-radius: 12px; background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-secondary); }
.dsh_activity_notes { padding: 10px 12px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 9px; color: var(--dsw-alias-label-secondary); }
.dsh_activity_notes summary { color: var(--dsw-alias-label-primary); cursor: pointer; font-weight: 600; }
.dsh_activity_notes p { margin: 9px 0 0; line-height: 21px; }
.dsh_activity_reliability { display: flex; flex-direction: column; gap: 9px; margin-top: 13px; }
.dsh_activity_reliability > div { display: grid; grid-template-columns: 90px minmax(100px, 1fr) 70px; gap: 10px; align-items: center; font-variant-numeric: tabular-nums; }
.dsh_activity_reliability > div > div { height: 7px; overflow: hidden; border-radius: 4px; background: var(--dsw-alias-bg-layer-3); }
.dsh_activity_reliability i { display: block; height: 100%; background: var(--dsw-alias-state-error-primary); }
.dsh_activity_reliability strong { font-weight: 550; text-align: right; }

@media (max-width: 760px) {
  .dsh_activity_hero { flex-direction: column; gap: 10px; }
  .dsh_activity_privacy { max-width: none; text-align: left; }
  .dsh_activity_toolbar { align-items: stretch; }
  .dsh_activity_toolbarGroup { flex: 1 1 100%; }
  .dsh_activity_toolbarFilters { flex-wrap: wrap; }
  .dsh_activity_toolbarActions { margin-left: 0; }
  .dsh_activity_toolbarActions > * { flex: 1; }
  .dsh_activity_ranges { width: 100%; }
  .dsh_activity_ranges button { flex: 1; }
  .dsh_activity_status { align-items: flex-start; flex-direction: column; gap: 8px; }
  .dsh_activity_statusMeta { gap: 8px 14px; }
  .dsh_activity_cards { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .dsh_activity_panel { padding: 12px; }
  .dsh_activity_panelHeading { flex-direction: column; }
  .dsh_activity_toggle { align-self: stretch; }
  .dsh_activity_toggle button { flex: 1; }
  .dsh_activity_tooltip { position: static; margin: 8px 0; }
}
`

/** Adopt the activity stylesheet and return one idempotent ownership release. */
export function adoptStyles(): () => void {
  if (typeof document === 'undefined') return () => {}
  let style = document.getElementById('dsh-activity-report-styles') as HTMLStyleElement | null
  if (style === null) {
    style = document.createElement('style')
    style.id = 'dsh-activity-report-styles'
    document.head.appendChild(style)
  }
  style.textContent = cssText
  style.dataset.activityUsers = String(Number(style.dataset.activityUsers ?? '0') + 1)
  let released = false
  return () => {
    if (released) return
    released = true
    const current = document.getElementById('dsh-activity-report-styles') as HTMLStyleElement | null
    if (current === null) return
    const users = Math.max(0, Number(current.dataset.activityUsers ?? '0') - 1)
    current.dataset.activityUsers = String(users)
    if (users === 0) current.remove()
  }
}
