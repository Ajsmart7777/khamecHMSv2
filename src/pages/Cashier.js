import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { MainLayout } from '@/components/layout/MainLayout';
import { CashierPanel } from '@/components/billing/CashierPanel';
import { BalanceRequestsPanel } from '@/components/billing/BalanceRequestsPanel';
import { DischargeSettlementQueue } from '@/components/billing/DischargeSettlementQueue';
export default function Cashier() {
    return (_jsxs(MainLayout, { title: "Cashier", subtitle: "Collect payments, top-ups and refunds", children: [
            _jsx(DischargeSettlementQueue, {}), _jsxs("div", { className: "grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6", children: [
                    _jsx(BalanceRequestsPanel, { type: "topup" }), _jsx(BalanceRequestsPanel, { type: "refund" })
                ] }), _jsx(CashierPanel, {})
        ] }));
}
