import { Search, User, Calendar, Menu } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

import { NotificationPanel } from '@/components/layout/NotificationPanel';
import { useAuth } from '@/contexts/AuthContext';

interface TopBarProps {
  title: string;
  subtitle?: string;
  onMenuClick?: () => void;
  showMenuButton?: boolean;
}

export function TopBar({ title, subtitle, onMenuClick, showMenuButton }: TopBarProps) {
  const { user, role } = useAuth();
  const today = new Date().toLocaleDateString('en-NG', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  return (
    <header className="sticky top-0 z-40 bg-background/80 backdrop-blur-md border-b border-border px-3 sm:px-4 md:px-6 py-3 md:py-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-3 min-w-0">
          {/* Mobile Menu Button */}
          {showMenuButton && (
            <Button 
              variant="ghost" 
              size="icon" 
              className="lg:hidden shrink-0"
              onClick={onMenuClick}
            >
              <Menu className="h-5 w-5" />
            </Button>
          )}
          
          <div className="min-w-0">
            <h1 className="text-lg sm:text-xl md:text-2xl font-bold text-foreground truncate">{title}</h1>
            {subtitle && <p className="text-xs sm:text-sm text-muted-foreground truncate">{subtitle}</p>}
          </div>
        </div>

        <div className="flex items-center gap-2 sm:gap-4 shrink-0">


          {/* Date */}
          <div className="hidden md:flex items-center gap-2 text-sm text-muted-foreground">
            <Calendar className="h-4 w-4" />
            <span>{today}</span>
          </div>

          {/* Search */}
          <div className="relative hidden lg:block">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input 
              placeholder="Search patients, records..." 
              className="w-72 pl-10 bg-muted/50 border-0 focus-visible:ring-1"
            />
          </div>

          {/* Notifications */}
          <NotificationPanel />

          {/* User */}
          <div className="flex items-center gap-2 sm:gap-3 pl-2 sm:pl-4 border-l border-border">
            <div className="text-right hidden sm:block">
              <p className="text-sm font-medium">{user?.email?.split('@')[0] || 'Staff'}</p>
              <p className="text-xs text-muted-foreground capitalize">{role || 'User'}</p>
            </div>
            <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-full bg-primary/10 flex items-center justify-center">
              <User className="h-4 w-4 sm:h-5 sm:w-5 text-primary" />
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
