import { useState } from 'react';
import { Dropdown } from './Dropdown';
import { Icon } from './Icon';
import { errorText, useFeedback } from './feedback';
import { exportTable, type ExportKind, type ExportTable } from '../../lib/exporters';

/** "Export ▾" with Excel, PDF and CSV. The table is built only when a format is picked. */
export function ExportMenu({ build, name, disabled, label = 'Export', small = true }: {
  build: () => ExportTable; name: string; disabled?: boolean; label?: string; small?: boolean;
}) {
  const { toast } = useFeedback();
  const [busy, setBusy] = useState(false);
  const run = async (kind: ExportKind, close: () => void) => {
    close();
    setBusy(true);
    try { await exportTable(build(), kind, name); }
    catch (e) { toast(errorText(e), true); }
    finally { setBusy(false); }
  };
  if (disabled) return <button type="button" className={`btn${small ? ' sm' : ''}`} disabled><Icon name="download" size={16} />{label}</button>;
  return (
    <Dropdown className={`btn${small ? ' sm' : ''}`} label={`${label}: choose a file type`} panelLabel="Export as" panelClass="dd-actions"
      button={<><Icon name="download" size={16} />{busy ? 'Preparing…' : label} ▾</>}>
      {(close) => (
        <nav className="dd-menu" aria-label="Export as">
          <button type="button" onClick={() => void run('xlsx', close)}><strong>Excel</strong> <span className="muted small">.xlsx — numbers and dates ready to sort and add up</span></button>
          <button type="button" onClick={() => void run('pdf', close)}><strong>PDF</strong> <span className="muted small">— to share or print</span></button>
          <button type="button" onClick={() => void run('csv', close)}><strong>CSV</strong> <span className="muted small">— plain text, for other software or re-import</span></button>
        </nav>
      )}
    </Dropdown>
  );
}
