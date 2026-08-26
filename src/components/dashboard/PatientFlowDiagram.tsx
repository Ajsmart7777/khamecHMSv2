import { 
  Users, 
  Activity, 
  Stethoscope, 
  FlaskConical, 
  Receipt, 
  Pill, 
  Package, 
  Wallet, 
  ClipboardCheck, 
  Shield,
  ArrowRight,
  ArrowDown
} from 'lucide-react';
import { cn } from '@/lib/utils';

const clinicalNodes = [
  { id: 'reception', label: 'Reception', icon: Users, color: 'bg-module-reception' },
  { id: 'nurse', label: 'Nurse', icon: Activity, color: 'bg-module-nurse' },
  { id: 'clinical_team', label: 'Clinical Team', icon: Stethoscope, color: 'bg-module-clinical' },
  { id: 'lab', label: 'Lab', icon: FlaskConical, color: 'bg-module-lab' },
];

const supportNodes = [
  { id: 'billing', label: 'Billing', icon: Receipt, color: 'bg-module-billing' },
  { id: 'pharmacy', label: 'Pharmacy', icon: Pill, color: 'bg-module-pharmacy' },
  
];

const financialNodes = [
  { id: 'account', label: 'Account', icon: Wallet, color: 'bg-module-account' },
  { id: 'auditing', label: 'Auditing', icon: ClipboardCheck, color: 'bg-module-auditing' },
  { id: 'admin', label: 'Admin', icon: Shield, color: 'bg-module-admin' },
];

function FlowNode({ node, compact = false }: { node: typeof clinicalNodes[0]; compact?: boolean }) {
  return (
    <div className={cn(
      "workflow-node flex flex-col items-center gap-1.5 sm:gap-3 border-2 p-2 sm:p-4",
      `border-${node.color.replace('bg-', '')}/30`
    )}>
      <div className={cn("p-2 sm:p-3 rounded-lg sm:rounded-xl", node.color + '/15')}>
        <node.icon className={cn("h-5 w-5 sm:h-6 sm:w-6", node.color.replace('bg-', 'text-'))} />
      </div>
      <span className="font-medium text-xs sm:text-sm">{node.label}</span>
    </div>
  );
}

export function PatientFlowDiagram() {
  return (
    <div className="bg-card rounded-xl border border-border p-3 sm:p-6">
      <h3 className="font-semibold text-foreground text-sm sm:text-base mb-4 sm:mb-6">Patient Flow & System Workflow</h3>
      
      {/* Main Patient Flow - horizontal scroll on mobile */}
      <div className="overflow-x-auto -mx-3 px-3 sm:mx-0 sm:px-0">
        <div className="min-w-[400px]">
          {/* Row 1: Clinical Path */}
          <div className="grid grid-cols-4 gap-2 sm:gap-4 mb-4 sm:mb-8">
            {clinicalNodes.map((node, index) => (
              <div key={node.id} className="relative">
                <FlowNode node={node} />
                {index < 3 && (
                  <ArrowRight className="absolute -right-2 sm:-right-4 top-1/2 -translate-y-1/2 h-4 w-4 sm:h-5 sm:w-5 text-muted-foreground" />
                )}
              </div>
            ))}
          </div>

          {/* Arrows down */}
          <div className="flex justify-center mb-2 sm:mb-4">
            <div className="flex items-center gap-12 sm:gap-20">
              <ArrowDown className="h-4 w-4 sm:h-5 sm:w-5 text-muted-foreground" />
              <ArrowDown className="h-4 w-4 sm:h-5 sm:w-5 text-muted-foreground ml-16 sm:ml-32" />
            </div>
          </div>

          {/* Row 2: Support Path */}
          <div className="grid grid-cols-4 gap-2 sm:gap-4 mb-4 sm:mb-8">
            {supportNodes.map((node) => (
              <div key={node.id}>
                <FlowNode node={node} />
              </div>
            ))}
            <div className="flex items-center justify-center">
              <span className="text-xs sm:text-sm text-muted-foreground italic">Inventory Flow</span>
            </div>
          </div>
        </div>
      </div>

      {/* Financial Flow */}
      <div className="border-t border-border pt-4 sm:pt-6 mt-2 sm:mt-4">
        <h4 className="text-xs sm:text-sm font-medium text-muted-foreground mb-3 sm:mb-4">Financial & Admin Oversight</h4>
        <div className="overflow-x-auto -mx-3 px-3 sm:mx-0 sm:px-0">
          <div className="flex items-center justify-center gap-3 sm:gap-8 min-w-[320px]">
            {financialNodes.map((node, index) => (
              <div key={node.id} className="flex items-center gap-2 sm:gap-4">
                <div className={cn(
                  "workflow-node flex items-center gap-2 sm:gap-3 px-2 sm:px-4 py-2 sm:py-3 border-2",
                  `border-${node.color.replace('bg-', '')}/30`
                )}>
                  <div className={cn("p-1.5 sm:p-2 rounded-lg", node.color + '/15')}>
                    <node.icon className={cn("h-4 w-4 sm:h-5 sm:w-5", node.color.replace('bg-', 'text-'))} />
                  </div>
                  <span className="font-medium text-xs sm:text-sm">{node.label}</span>
                </div>
                {index < financialNodes.length - 1 && (
                  <ArrowRight className="h-4 w-4 sm:h-5 sm:w-5 text-muted-foreground shrink-0" />
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center justify-center gap-4 sm:gap-6 mt-4 sm:mt-6 pt-3 sm:pt-4 border-t border-border">
        <div className="flex items-center gap-1.5 sm:gap-2">
          <span className="w-2.5 h-2.5 sm:w-3 sm:h-3 rounded-full bg-success animate-pulse" />
          <span className="text-[10px] sm:text-xs text-muted-foreground">Active</span>
        </div>
        <div className="flex items-center gap-1.5 sm:gap-2">
          <span className="w-2.5 h-2.5 sm:w-3 sm:h-3 rounded-full bg-warning animate-pulse" />
          <span className="text-[10px] sm:text-xs text-muted-foreground">Busy</span>
        </div>
        <div className="flex items-center gap-1.5 sm:gap-2">
          <span className="w-2.5 h-2.5 sm:w-3 sm:h-3 rounded-full bg-muted-foreground" />
          <span className="text-[10px] sm:text-xs text-muted-foreground">Idle</span>
        </div>
      </div>
    </div>
  );
}
