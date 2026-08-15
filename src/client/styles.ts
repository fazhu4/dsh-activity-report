/** Inline styles for the activity panel (DSH design tokens). */

export const cssText = `
.dsh_activity_section {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
}
.dsh_activity_heading {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.dsh_activity_title {
  margin: 0;
  color: var(--dsw-alias-label-primary);
  font-size: 18px;
  line-height: 26px;
  font-weight: 600;
}
.dsh_activity_subtitle {
  margin: 0;
  color: var(--dsw-alias-label-tertiary);
  font-size: 13px;
  line-height: 20px;
}
.dsh_activity_toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.dsh_activity_seg {
  display: inline-flex;
  gap: 2px;
  padding: 2px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 10px;
  background: var(--dsw-alias-bg-layer-1);
}
.dsh_activity_segBtn {
  border: none;
  border-radius: 8px;
  padding: 4px 12px;
  font-size: 13px;
  line-height: 20px;
  cursor: pointer;
  color: var(--dsw-alias-label-secondary);
  background: transparent;
}
.dsh_activity_segBtn:hover {
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-bg-layer-2);
}
.dsh_activity_segBtnActive {
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-bg-layer-3);
  font-weight: 600;
}
.dsh_activity_refresh {
  margin-left: auto;
}
.dsh_activity_cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 10px;
}
.dsh_activity_card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px 14px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 12px;
  background: var(--dsw-alias-bg-layer-1);
}
.dsh_activity_cardLabel {
  color: var(--dsw-alias-label-tertiary);
  font-size: 12px;
  line-height: 16px;
}
.dsh_activity_cardValue {
  color: var(--dsw-alias-label-primary);
  font-size: 20px;
  line-height: 28px;
  font-weight: 600;
}
.dsh_activity_tabs {
  display: flex;
  gap: 4px;
  border-bottom: 1px solid var(--dsw-alias-border-l2);
}
.dsh_activity_tab {
  border: none;
  background: transparent;
  padding: 6px 12px;
  font-size: 13px;
  line-height: 20px;
  cursor: pointer;
  color: var(--dsw-alias-label-secondary);
  border-bottom: 2px solid transparent;
}
.dsh_activity_tab:hover {
  color: var(--dsw-alias-label-primary);
}
.dsh_activity_tabActive {
  color: var(--dsw-alias-label-primary);
  border-bottom-color: var(--dsw-alias-brand-primary);
  font-weight: 600;
}
.dsh_activity_chart {
  padding: 4px 0;
  min-width: 0;
}
.dsh_activity_trend {
  padding: 6px 0;
  min-width: 0;
}
.dsh_activity_bars {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 6px;
  min-width: 0;
}
.dsh_activity_barRow {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.dsh_activity_barLabel {
  flex: 0 0 150px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  line-height: 16px;
  text-align: right;
}
.dsh_activity_barTrack {
  flex: 1 1 auto;
  min-width: 40px;
  height: 14px;
  border-radius: 7px;
  background: var(--dsw-alias-bg-layer-2);
  overflow: hidden;
}
.dsh_activity_barFill {
  height: 100%;
  border-radius: 7px;
  background: var(--dsw-alias-brand-primary);
  opacity: 0.85;
  transition: width 200ms ease;
}
.dsh_activity_barValue {
  flex: 0 0 56px;
  text-align: right;
  color: var(--dsw-alias-label-primary);
  font-size: 12px;
  line-height: 16px;
  font-variant-numeric: tabular-nums;
}
.dsh_activity_tableWrap {
  overflow-x: auto;
  min-width: 0;
}
.dsh_activity_table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
  line-height: 20px;
}
.dsh_activity_table th {
  text-align: left;
  color: var(--dsw-alias-label-tertiary);
  font-weight: 500;
  padding: 6px 10px;
  border-bottom: 1px solid var(--dsw-alias-border-l2);
  white-space: nowrap;
}
.dsh_activity_table td {
  padding: 6px 10px;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
  color: var(--dsw-alias-label-primary);
  white-space: nowrap;
}
.dsh_activity_table td:first-child,
.dsh_activity_table th:first-child {
  padding-left: 2px;
}
.dsh_activity_num {
  font-variant-numeric: tabular-nums;
  text-align: right;
}
.dsh_activity_empty {
  padding: 32px 0;
  text-align: center;
  color: var(--dsw-alias-label-tertiary);
  font-size: 13px;
}
.dsh_activity_toolChip {
  display: inline-flex;
  gap: 4px;
  align-items: baseline;
  margin: 1px 6px 1px 0;
  padding: 1px 6px;
  border-radius: 6px;
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  white-space: nowrap;
}
.dsh_activity_sessionLink {
  color: var(--dsw-alias-brand-primary);
  cursor: pointer;
  text-decoration: none;
}
.dsh_activity_sessionLink:hover {
  text-decoration: underline;
}
.dsh_activity_updated {
  color: var(--dsw-alias-label-tertiary);
  font-size: 12px;
  line-height: 16px;
}
`

/** Adopt the stylesheet once. */
export function adoptStyles(): void {
  if (typeof document === 'undefined') return
  if (document.getElementById('dsh-activity-report-styles')) return
  const style = document.createElement('style')
  style.id = 'dsh-activity-report-styles'
  style.textContent = cssText
  document.head.appendChild(style)
}
