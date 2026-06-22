import { Component, type ErrorInfo, type ReactNode } from 'react';
import { QueryErrorFallback } from './QueryErrorFallback';

type ErrorBoundaryProps = {
  children: ReactNode;
};

type ErrorBoundaryState = {
  error: Error | null;
};

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-screen items-center justify-center p-6">
          <div className="w-full max-w-lg">
            <QueryErrorFallback
              title="页面渲染出错"
              error={this.state.error}
              onRetry={() => this.setState({ error: null })}
            />
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
