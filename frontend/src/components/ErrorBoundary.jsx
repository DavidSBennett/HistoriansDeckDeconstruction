// Shows a message instead of a blank page if the table fails to draw. The game itself is safe on the
// server; reloading picks it up again.
import { Component } from "react";

export default class ErrorBoundary extends Component {
  state = { error: null };
  static getDerivedStateFromError(error) {
    return { error };
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="page">
        <div className="panel">
          <h2>Something went wrong on this page</h2>
          <p>Your game is safe on the server. Reload the page to pick it up again.</p>
          <p className="note">{String(this.state.error.message || this.state.error)}</p>
          <button onClick={() => location.reload()}>Reload</button>
        </div>
      </div>
    );
  }
}
