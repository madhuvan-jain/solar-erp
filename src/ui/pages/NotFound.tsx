import { Link } from 'react-router-dom';

export function NotFound({ text = 'This page does not exist.' }: { text?: string }) {
  return (
    <div className="card empty">
      <h2>Not found</h2>
      <p>{text}</p>
      <Link className="btn" to="/">Go to dashboard</Link>
    </div>
  );
}

export function NoAccess() {
  return (
    <div className="card empty">
      <h2>No access</h2>
      <p>Your role does not include this module. Ask an admin if you need it.</p>
      <Link className="btn" to="/">Go to dashboard</Link>
    </div>
  );
}
