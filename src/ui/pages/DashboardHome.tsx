import { useState } from 'react';
import { useStore } from '../../lib/store';
import { deleteDashboard, emptyDashboard, loadDashboard, saveDashboard, solarTemplate, type DashboardDef } from '../../lib/dashboards';
import { Dashboard } from './Dashboard';
import { MyDashboard } from './MyDashboard';
import { useDialogFocus, useFeedback, errorText } from '../components/feedback';

/**
 * The Dashboard app: the person's own dashboard when they have made one (it opens first), otherwise the
 * default one. One custom dashboard per person for now.
 */
export function DashboardHome() {
  const store = useStore();
  const { toast } = useFeedback();
  const uid = store.user?.id || '';
  const [mine, setMine] = useState<DashboardDef | null>(() => loadDashboard(uid));
  const [which, setWhich] = useState<'mine' | 'default'>(mine ? 'mine' : 'default');
  const [editing, setEditing] = useState(false);
  const [creating, setCreating] = useState(false);

  const change = (d: DashboardDef) => {
    setMine(d);
    try { saveDashboard(uid, d); } catch (e) { toast(errorText(e), true); }
  };
  const create = (d: DashboardDef) => {
    change(d);
    setWhich('mine');
    setEditing(d.items.length === 0);
    setCreating(false);
    toast('Your dashboard is ready. It opens first from now on.');
  };

  return (
    <>
      <div className="dash-switch no-print">
        <div className="dash-tabs" role="tablist" aria-label="Dashboards">
        {mine && <button type="button" role="tab" aria-selected={which === 'mine'} className={which === 'mine' ? 'on' : ''} onClick={() => setWhich('mine')}>{mine.title || 'My dashboard'}</button>}
        <button type="button" role="tab" aria-selected={which === 'default'} className={which === 'default' ? 'on' : ''} onClick={() => { setWhich('default'); setEditing(false); }}>Default dashboard</button>
        </div>
        {!mine && <button type="button" className="btn sm" onClick={() => setCreating(true)}>+ Create my dashboard</button>}
      </div>
      {which === 'mine' && mine
        ? <MyDashboard def={mine} onChange={change} editing={editing} setEditing={setEditing}
            onDelete={() => { deleteDashboard(uid); setMine(null); setWhich('default'); setEditing(false); toast('Your dashboard was deleted'); }} />
        : <Dashboard />}
      {creating && <CreateDialog onCancel={() => setCreating(false)} onPick={(kind) => create(kind === 'template' ? solarTemplate() : emptyDashboard())} />}
    </>
  );
}

function CreateDialog({ onPick, onCancel }: { onPick: (k: 'template' | 'empty') => void; onCancel: () => void }) {
  const dlg = useDialogFocus(true, onCancel);
  return (
    <div className="modal-back">
      <div ref={dlg} className="modal" role="dialog" aria-modal="true" aria-labelledby="cd-title">
        <h2 id="cd-title">Create my dashboard</h2>
        <p className="muted">You can have one dashboard of your own. Add KPI tiles, charts, top lists, records, the India map, alerts and notes, then move and resize them.</p>
        <div className="create-pick">
          <button type="button" className="card" onClick={() => onPick('template')}>
            <strong>Start from the solar template</strong>
            <span className="muted small">Invoiced, collected, still to collect, open leads, sales by month, lead sources, pipeline, top customers, map, alerts — then change anything.</span>
          </button>
          <button type="button" className="card" onClick={() => onPick('empty')}>
            <strong>Start empty</strong>
            <span className="muted small">A blank grid; add exactly the items you want.</span>
          </button>
        </div>
        <div className="btn-row" style={{ justifyContent: 'flex-end', marginTop: 12 }}><button type="button" className="btn" onClick={onCancel}>Cancel</button></div>
      </div>
    </div>
  );
}
