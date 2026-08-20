import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  isReloading: boolean;
}

/** Keeps an unexpected screen error recoverable instead of rendering a blank page. */
export class AppErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, isReloading: false };

  static getDerivedStateFromError(): State {
    return { hasError: true, isReloading: false };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Unhandled HMS screen error', error, errorInfo);
  }

  /**
   * A deployed PWA can briefly retain an old app shell or workbox cache after a
   * release. Clear only service-worker registrations/caches; never clear HMS
   * localStorage because it contains the authenticated session and settings.
   */
  private reload = async () => {
    if (this.state.isReloading) return;
    this.setState({ isReloading: true });

    try {
      if ('serviceWorker' in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registrations.map((registration) => registration.unregister()));
      }

      if ('caches' in window) {
        const cacheNames = await caches.keys();
        await Promise.all(cacheNames.map((cacheName) => caches.delete(cacheName)));
      }
    } catch (error) {
      console.warn('Could not clear the stale app cache before reload', error);
    } finally {
      // A normal reload can still reuse an HTTP-cached index.html after the old
      // worker has been unregistered. A one-time query string forces Chrome to
      // request the current shell from Netlify while preserving HMS localStorage.
      const url = new URL(window.location.href);
      url.searchParams.set('hms_refresh', Date.now().toString());
      window.location.replace(url.toString());
    }
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
                Your work has not been changed. We will clear only the outdated app cache and reload the latest workspace.
              </p>
            </div>
            <Button onClick={this.reload} disabled={this.state.isReloading} className="w-full">
              <RefreshCw className={`mr-2 h-4 w-4 ${this.state.isReloading ? 'animate-spin' : ''}`} aria-hidden="true" />
              {this.state.isReloading ? 'Loading latest workspace…' : 'Reload latest workspace'}
            </Button>
          </section>
        </main>
      );
    }

    return this.props.children;
  }
}
