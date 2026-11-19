import { Link } from 'react-router-dom';
import { useStore } from '../../lib/store';
import { myAlerts, type Alert } from '../../lib/alerts';
import { canRead } from '../../lib/rbac';
import { getEntity } from '../../modules/registry';

const LEVEL_TAG: Record<Alert['level'], { cls: string; label: string }> = {
  danger: { cls: 'bad', label: '⚠ Action needed' },
  warning: { cls: 'warn', label: '● Attention' },
  info: { cls: 'info', label: 'ℹ Info' },
};

export function AlertList({ alerts, limit }: { alerts: Alert[]; limit?: number }) {
  if (!alerts.length) return <p className="muted">All clear — nothing needs attention.</p>;
  const shown = limit ? alerts.slice(0, limit) : alerts;
  return (
    <>
      <ul className="alert-list">
        {shown.map((a) => (
          <li key={a.id}>
            <Link to={`/m/${a.entity}/${a.recordId}`}>
              <span className={'badge tag ' + LEVEL_TAG[a.level].cls}>{LEVEL_TAG[a.level].label}</span>
              <span>{a.text}</span>
            </Link>
          </li>
        ))}
      </ul>
      {limit && alerts.length > limit && <Link className="small" to="/alerts">View all {alerts.length} alerts →</Link>}
    </>
  );
}

export function AlertsPage() {
  const store = useStore();
  const alerts = myAlerts(store, (m) => canRead(store.user, m), (e) => getEntity(e)?.module || '');
  return (
    <>
      <div className="page-head"><h1>Alerts & reminders</h1></div>
      <div className="card"><AlertList alerts={alerts} /></div>
    </>
  );
}
