import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

/** Keeps an unexpected screen error recoverable instead of rendering a blank page. */
export class AppErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Unhandled HMS screen error', error, errorInfo);
  }

  private reload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <main className="min-h-screen bg-muted/30 flex items-center justify-center p-6">
          <section className="w-full max-w-md rounded-xl border bg-background p-6 shadow-sm text-center space-y-4">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
              <AlertTriangle className="h-6 w-6" aria-hidden="true" />
            </div>
            <div className="space-y-2">
              <h1 className="text-lg font-semibold">This screen could not be opened</h1>
              <p className="text-sm text-muted-foreground">
                Your work has not been changed. Reload the workspace, then try the screen again.
              </p>
            </div>
            <Button onClick={this.reload} className="w-full">
              <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
              Reload workspace
            </Button>
          </section>
        </main>
      );
    }

    return this.props.children;
  }
}
