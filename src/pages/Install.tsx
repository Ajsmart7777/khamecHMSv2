import { useState, useEffect } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Download, Smartphone, Monitor, Apple, Chrome } from 'lucide-react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export default function Install() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', handler);

    if (window.matchMedia('(display-mode: standalone)').matches) {
      setIsInstalled(true);
    }

    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') setIsInstalled(true);
    setDeferredPrompt(null);
  };

  return (
    <MainLayout title="Install App" subtitle="Install KMC HMS on your device for quick access">
      <div className="max-w-2xl mx-auto space-y-6">
        {isInstalled ? (
          <Card className="border-primary/30 bg-primary/5">
            <CardContent className="pt-6 text-center space-y-2">
              <Smartphone className="h-12 w-12 mx-auto text-primary" />
              <h3 className="text-lg font-semibold text-primary">App Already Installed</h3>
              <p className="text-sm text-muted-foreground">KMC HMS is installed on this device.</p>
            </CardContent>
          </Card>
        ) : deferredPrompt ? (
          <Card>
            <CardContent className="pt-6 text-center space-y-4">
              <Download className="h-12 w-12 mx-auto text-primary" />
              <h3 className="text-lg font-semibold">Ready to Install</h3>
              <p className="text-sm text-muted-foreground">Tap below to add KMC HMS to your home screen.</p>
              <Button size="lg" onClick={handleInstall} className="gap-2">
                <Download className="h-4 w-4" /> Install KMC HMS
              </Button>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="pt-6 text-center space-y-2">
              <Monitor className="h-12 w-12 mx-auto text-muted-foreground" />
              <h3 className="text-lg font-semibold">Install via Browser Menu</h3>
              <p className="text-sm text-muted-foreground">Use your browser's install option or follow the instructions below.</p>
            </CardContent>
          </Card>
        )}

        {/* Android Instructions */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Chrome className="h-5 w-5 text-primary" /> Android (Chrome)
            </CardTitle>
            <CardDescription>Install from Chrome browser</CardDescription>
          </CardHeader>
          <CardContent>
            <ol className="list-decimal list-inside space-y-2 text-sm text-muted-foreground">
              <li>Open this app in <strong>Chrome</strong></li>
              <li>Tap the <strong>⋮ menu</strong> (top right)</li>
              <li>Select <strong>"Add to Home screen"</strong> or <strong>"Install app"</strong></li>
              <li>Tap <strong>"Install"</strong> to confirm</li>
            </ol>
          </CardContent>
        </Card>

        {/* iOS Instructions */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Apple className="h-5 w-5 text-primary" /> iPhone / iPad (Safari)
            </CardTitle>
            <CardDescription>Install from Safari browser</CardDescription>
          </CardHeader>
          <CardContent>
            <ol className="list-decimal list-inside space-y-2 text-sm text-muted-foreground">
              <li>Open this app in <strong>Safari</strong></li>
              <li>Tap the <strong>Share button</strong> (square with arrow)</li>
              <li>Scroll down and tap <strong>"Add to Home Screen"</strong></li>
              <li>Tap <strong>"Add"</strong> to confirm</li>
            </ol>
          </CardContent>
        </Card>
      </div>
    </MainLayout>
  );
}
