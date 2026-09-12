import React, { Component, ErrorInfo, ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-full w-full flex-col items-center justify-center p-4 text-center bg-(--bg) text-(--text)">
          <h1 className="mb-2 text-lg font-bold text-(--danger)">Something went wrong</h1>
          <p className="mb-4 text-sm text-(--text-muted)">{this.state.error?.message}</p>
          <button
            onClick={() => window.location.reload()}
            className="rounded-md bg-(--active) px-3 py-1 text-xs font-medium text-(--text)"
          >
            Reload App
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
