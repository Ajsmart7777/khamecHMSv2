import * as React from 'react';
import { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

interface StatsCardProps extends React.HTMLAttributes<HTMLDivElement> {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: LucideIcon;
  trend?: {
    value: number;
    isPositive: boolean;
  };
  color?: string;
}

export const StatsCard = React.forwardRef<HTMLDivElement, StatsCardProps>(
  ({ title, value, subtitle, icon: Icon, trend, color = 'text-primary', className, ...props }, ref) => {
    return (
      <div ref={ref} className={cn("stat-card group", className)} {...props}>
        <div className="flex items-start justify-between gap-1.5 sm:gap-2">
          <div className="space-y-0.5 sm:space-y-1 min-w-0 flex-1">
            <p className="text-[10px] sm:text-xs md:text-sm font-medium text-muted-foreground leading-tight line-clamp-2">{title}</p>
            <p className="text-lg sm:text-2xl md:text-3xl font-bold text-foreground">{value}</p>
            {subtitle && (
              <p className="text-[10px] sm:text-xs text-muted-foreground truncate">{subtitle}</p>
            )}
            {trend && (
              <div className={cn(
                "inline-flex items-center gap-1 text-[10px] sm:text-xs font-medium",
                trend.isPositive ? "text-success" : "text-destructive"
              )}>
                <span>{trend.isPositive ? '↑' : '↓'}</span>
                <span className="hidden sm:inline">{Math.abs(trend.value)}% from yesterday</span>
                <span className="sm:hidden">{Math.abs(trend.value)}%</span>
              </div>
            )}
          </div>
          <div className={cn(
            "p-2 sm:p-3 rounded-lg sm:rounded-xl transition-all duration-300 group-hover:scale-110 shrink-0",
            color.replace('text-', 'bg-') + '/10'
          )}>
            <Icon className={cn("h-4 w-4 sm:h-5 sm:w-5 md:h-6 md:w-6", color)} />
          </div>
        </div>
        
        {/* Decorative gradient */}
        <div className={cn(
          "absolute bottom-0 left-0 right-0 h-1 rounded-b-xl opacity-0 group-hover:opacity-100 transition-opacity",
          "bg-gradient-to-r",
          color.includes('primary') && "from-primary/50 to-primary",
          color.includes('success') && "from-success/50 to-success",
          color.includes('warning') && "from-warning/50 to-warning",
          color.includes('info') && "from-info/50 to-info",
          color.includes('destructive') && "from-destructive/50 to-destructive",
          color.includes('reception') && "from-module-reception/50 to-module-reception",
          color.includes('nurse') && "from-module-nurse/50 to-module-nurse",
          color.includes('doctor') && "from-module-doctor/50 to-module-doctor",
          color.includes('pharmacy') && "from-module-pharmacy/50 to-module-pharmacy",
        )} />
      </div>
    );
  }
);

StatsCard.displayName = 'StatsCard';
