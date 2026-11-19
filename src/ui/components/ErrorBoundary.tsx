import { Component, type ReactNode } from 'react';

/** Last line of defence: a render crash shows a recovery screen instead of a blank page. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error(error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="auth">
        <div className="card center">
          <h2>Something went wrong</h2>
          <p className="muted">Your saved data is safe. Reload the page to continue.</p>
          <p className="muted small">{this.state.error.message}</p>
          <div className="btn-row" style={{ justifyContent: 'center' }}>
            <button className="btn primary" onClick={() => location.reload()}>Reload</button>
            <button className="btn" onClick={() => { location.hash = '#/'; location.reload(); }}>Go to dashboard</button>
          </div>
        </div>
      </div>
    );
  }
}
