import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground hover:bg-primary/80",
        secondary: "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80",
        destructive: "border-transparent bg-destructive text-destructive-foreground hover:bg-destructive/80",
        outline: "text-foreground",
        success: "border-transparent bg-success text-success-foreground",
        warning: "border-transparent bg-warning text-warning-foreground",
        info: "border-transparent bg-info text-info-foreground",
        // Module-specific variants
        reception: "border-transparent bg-module-reception/15 text-module-reception",
        nurse: "border-transparent bg-module-nurse/15 text-module-nurse",
        clinical: "border-transparent bg-module-clinical/15 text-module-clinical",
        lab: "border-transparent bg-module-lab/15 text-module-lab",
        billing: "border-transparent bg-module-billing/15 text-module-billing",
        pharmacy: "border-transparent bg-module-pharmacy/15 text-module-pharmacy",
        account: "border-transparent bg-module-account/15 text-module-account",
        auditing: "border-transparent bg-module-auditing/15 text-module-auditing",
        admin: "border-transparent bg-module-admin/15 text-module-admin",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

const Badge = React.forwardRef<HTMLDivElement, BadgeProps>(
  ({ className, variant, ...props }, ref) => {
    return <div ref={ref} className={cn(badgeVariants({ variant }), className)} {...props} />;
  }
);

Badge.displayName = 'Badge';

export { Badge, badgeVariants };
