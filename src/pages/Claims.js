import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { MainLayout } from '@/components/layout/MainLayout';
import { InsuranceManager } from '@/components/accounts/InsuranceManager';
import { EligibilityQueue } from '@/components/claims/EligibilityQueue';
import { InsuranceClaimsPanel } from '@/components/claims/InsuranceClaimsPanel';
import { useEligibilityVerifications } from '@/hooks/useEligibilityVerifications';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
const Claims = () => {
    const { pending } = useEligibilityVerifications();
    return (_jsx(MainLayout, { title: "Claims Management", subtitle: "Settled sponsored visits \u2014 insurance & scheme claims", children: _jsxs(Tabs, { defaultValue: "verifications", className: "w-full", children: [
                _jsxs(TabsList, { className: "mb-4", children: [
                        _jsxs(TabsTrigger, { value: "verifications", children: ["New Verifications", pending.length > 0 && (_jsx(Badge, { variant: "warning", className: "ml-1.5 h-5 px-1.5", children: pending.length }))] }), _jsx(TabsTrigger, { value: "cards", children: "Discharged Cards" }), _jsx(TabsTrigger, { value: "providers", children: "Insurance Providers" })
                    ] }), _jsx(TabsContent, { value: "verifications", children: _jsx(EligibilityQueue, {}) }), _jsx(TabsContent, { value: "cards", children: _jsx(InsuranceClaimsPanel, {}) }), _jsx(TabsContent, { value: "providers", children: _jsx(InsuranceManager, {}) })
            ] }) }));
};
export default Claims;
