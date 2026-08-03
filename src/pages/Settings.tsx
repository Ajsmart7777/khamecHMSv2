import { useState } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/contexts/AuthContext';
import { useSettings } from '@/contexts/SettingsContext';
import { ChangePasswordDialog } from '@/components/settings/ChangePasswordDialog';
import { LoginHistoryDialog } from '@/components/settings/LoginHistoryDialog';
import { Bell, Moon, Shield, User } from 'lucide-react';
import { toast } from 'sonner';

export default function Settings() {
  const { user, role } = useAuth();
  const { settings, updateSetting } = useSettings();
  const [showPasswordDialog, setShowPasswordDialog] = useState(false);
  const [showHistoryDialog, setShowHistoryDialog] = useState(false);

  const handleToggle = (key: keyof typeof settings, value: boolean) => {
    updateSetting(key, value);
    toast.success(`${key.replace(/([A-Z])/g, ' $1').trim()} ${value ? 'enabled' : 'disabled'}`);
  };

  return (
    <MainLayout title="Settings" subtitle="Manage your account and application preferences">
      <div className="grid gap-6 md:grid-cols-2">
        {/* Profile Settings */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <User className="h-5 w-5 text-primary" />
              Profile
            </CardTitle>
            <CardDescription>Your account information</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Email</Label>
              <Input value={user?.email || ''} disabled />
            </div>
            <div className="space-y-2">
              <Label>Role</Label>
              <Input value={role || 'Not assigned'} disabled className="capitalize" />
            </div>
            <Button variant="outline" className="w-full" onClick={() => setShowPasswordDialog(true)}>
              Change Password
            </Button>
          </CardContent>
        </Card>

        {/* Notification Settings */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Bell className="h-5 w-5 text-primary" />
              Alerts
            </CardTitle>
            <CardDescription>Station alert preferences</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label>Sound Alerts</Label>
                <p className="text-sm text-muted-foreground">Play sound when a patient arrives at your station</p>
              </div>
              <Switch 
                checked={settings.soundAlerts}
                onCheckedChange={(checked) => handleToggle('soundAlerts', checked)}
              />
            </div>
          </CardContent>
        </Card>

        {/* Appearance Settings */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Moon className="h-5 w-5 text-primary" />
              Appearance
            </CardTitle>
            <CardDescription>Customize the look and feel</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label>Dark Mode</Label>
                <p className="text-sm text-muted-foreground">Use dark theme</p>
              </div>
              <Switch 
                checked={settings.darkMode}
                onCheckedChange={(checked) => handleToggle('darkMode', checked)}
              />
            </div>
          </CardContent>
        </Card>

        {/* Security Settings */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-primary" />
              Security
            </CardTitle>
            <CardDescription>Account security options</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button variant="outline" className="w-full" onClick={() => setShowHistoryDialog(true)}>
              View Login History
            </Button>
          </CardContent>
        </Card>
      </div>

      <ChangePasswordDialog open={showPasswordDialog} onOpenChange={setShowPasswordDialog} />
      <LoginHistoryDialog open={showHistoryDialog} onOpenChange={setShowHistoryDialog} />
    </MainLayout>
  );
}
