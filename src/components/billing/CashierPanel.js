import { Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useMemo, useEffect } from 'react';
import { Wallet, Search, Banknote, AlertTriangle, PiggyBank, Shield, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription, } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { useInvoices } from '@/hooks/useInvoices';
import { usePatients } from '@/contexts/PatientContext';
import { paymentAuditLogger } from '@/lib/auditLogger';
import { supabase } from '@/integrations/supabase/client';
import { copayPercent, hasWallet, isSponsored, sponsorLabel, splitInvoice } from '@/lib/copay';
import { PrintableReceiptDialog } from '@/components/receipts/PrintableReceiptDialog';
import { nextStationForInvoice, workflowStationLabel } from '@/lib/workflowRouting';
// Wallet-enabled accounts (walk-in cash + staff_family) can carry a shortfall
// on their own balance. Sponsored/insured/staff settle via the sponsor.
const DEBT_ELIGIBLE = new Set(['normal', 'cash', '', 'staff_family']);
async function settleInvoiceAsPaid(invoiceId, paidAmount, paymentMethod, notes) {
    // Sponsor full-cover path: no wallet/debt changes, just close the invoice.
    const updatePayload = {
        paid_amount: paidAmount,
        status: 'paid',
        payment_method: paymentMethod,
        paid_at: new Date().toISOString(),
    };
    if (notes)
        updatePayload.notes = notes;
    const { error } = await supabase
        .from('invoices')
        .update(updatePayload)
        .eq('id', invoiceId);
    if (error)
        throw new Error(`Failed to settle invoice: ${error.message}`);
}
async function settleInvoiceAtomic(params) {
    const { data, error } = await supabase.rpc('settle_invoice_atomic', {
        _invoice_id: params.invoiceId,
        _cash_amount: params.cashAmount,
        _balance_amount: params.balanceAmount,
        _debt_amount: params.debtAmount,
        _payment_method: params.paymentMethod,
        _notes: params.notes ?? null,
        _sponsored: params.sponsored
    });
    if (error)
        throw new Error(`Failed to settle invoice: ${error.message}`);
    return data;
}
export function CashierPanel() {
    const { getPendingInvoices, refreshInvoices, invoices } = useInvoices();
    const { patients, updatePatientStatus, refreshPatients, updatePatient } = usePatients();
    const [query, setQuery] = useState('');
    const [filter, setFilter] = useState('all');
    const [bulkBusy, setBulkBusy] = useState(false);
    const [selected, setSelected] = useState(null);
    const [cashAmount, setCashAmount] = useState('');
    const [posAmount, setPosAmount] = useState('');
    const [transferAmount, setTransferAmount] = useState('');
    const [method, setMethod] = useState('cash');
    const [useBalance, setUseBalance] = useState(false);
    const [balanceAmount, setBalanceAmount] = useState('');
    const [isSalaryDeduction, setIsSalaryDeduction] = useState(false);
    const [salaryDeductionAmount, setSalaryDeductionAmount] = useState('');
    const [busy, setBusy] = useState(false);
    const [receipt, setReceipt] = useState(null);
    const pending = getPendingInvoices();
    const [refundItem, setRefundItem] = useState(null);
    const unavailableItems = useMemo(() => {
        // Automatically identify unavailable medication items for exclusion from sponsor totals
        // ensuring only eligible amounts are reclaimed or credited
        const allItems = invoices.flatMap(inv => (inv.items || []).map(it => ({ ...it, invoice: inv })));
        return allItems.filter(it => it.dispensing_status === 'refund_requested' ||
            it.dispensing_status === 'unavailable' ||
            it.dispensing_status === 'refund_pending' ||
            it.dispensing_status === 'not_given');
    }, [invoices]);
    const handleRefund = async (method) => {
        if (!refundItem)
            return;
        setBusy(true);
        try {
            // Safeguard: verify the item is not already refunded
            const { data: item } = await supabase.from('invoice_items').select('dispensing_status').eq('id', refundItem.item.id).single();
            if (item?.dispensing_status === 'refunded') {
                toast.error('Item has already been refunded');
                setRefundItem(null);
                return;
            }
            const { data, error } = await supabase.rpc('refund_invoice_item', {
                _item_id: refundItem.item.id,
                _payment_method: method
            });
            if (error)
                throw error;
            const res = data;
            if (res.new_balance !== undefined && typeof updatePatient === 'function') {
                updatePatient(refundItem.invoice.patient_id, { balance: res.new_balance });
            }
            await refreshInvoices();
            toast.success(res.is_sponsored ? 'Item removed from invoice & claim' : `Refunded ₦${res.amount.toLocaleString()} to ${method}`);
            setRefundItem(null);
        }
        catch (err) {
            toast.error('Refund failed: ' + err.message);
        }
        finally {
            setBusy(false);
        }
    };
    const rows = useMemo(() => {
        const q = query.trim().toLowerCase();
        return pending
            .map((inv) => {
            const patient = patients.find((p) => p.id === inv.patient_id);
            const spon = patient ? isSponsored(patient) : false;
            const copayPct = patient ? copayPercent(patient) : 100;
            // Exclude unavailable items from visibility for 0% copay insurance patients
            // so they don't even appear for "Record" if they were just removals.
            const activeItems = (inv.items || []).filter(it => it.dispensing_status !== 'unavailable' &&
                it.dispensing_status !== 'refund_requested' &&
                it.dispensing_status !== 'refund_pending' &&
                it.dispensing_status !== 'not_given');
            const activeTotal = activeItems.reduce((s, it) => s + (Number(it.total) || 0), 0);
            const { copayAmount } = patient ? splitInvoice(activeTotal, patient) : { copayAmount: activeTotal };
            const fullyCovered = spon && copayAmount === 0;
            return { inv: { ...inv, total_amount: activeTotal }, patient, fullyCovered, copayAmount };
        })
            .filter(({ fullyCovered }) => {
            if (filter === 'copay')
                return !fullyCovered;
            if (filter === 'covered')
                return fullyCovered;
            return true;
        })
            .filter(({ inv, patient }) => {
            if (!q)
                return true;
            return (inv.invoice_number.toLowerCase().includes(q) ||
                patient?.first_name?.toLowerCase().includes(q) ||
                patient?.last_name?.toLowerCase().includes(q) ||
                patient?.card_number?.toLowerCase().includes(q));
        });
    }, [pending, patients, query, filter]);
    // Every pending invoice a sponsor covers 100% (HMO, corporate, retainer,
    // staff, KATCHMA basic…) — the patient pays nothing at the cashier.
    const coveredRows = useMemo(() => pending
        .map((inv) => ({ inv, patient: patients.find((p) => p.id === inv.patient_id) }))
        .filter(({ inv, patient }) => patient &&
        isSponsored(patient) &&
        splitInvoice(Number(inv.total_amount), patient).copayAmount === 0), [pending, patients]);
    /** Acknowledge every fully covered invoice in one pass — no money changes hands. */
    const clearFullyCovered = async () => {
        if (coveredRows.length === 0)
            return;
        setBulkBusy(true);
        let done = 0;
        try {
            for (const { inv, patient } of coveredRows) {
                try {
                    await settleInvoiceAsPaid(inv.id, Number(inv.paid_amount), 'sponsor_claim', `Sponsor fully covered · ${sponsorLabel(patient)}`);
                    await paymentAuditLogger('payment_received', inv.invoice_number, {
                        patient_id: inv.patient_id,
                        patient_name: `${patient.first_name} ${patient.last_name ?? ''}`.trim(),
                        action: 'sponsor_fully_covered_bulk',
                        sponsor: sponsorLabel(patient),
                        covered_amount: Number(inv.total_amount) - Number(inv.paid_amount),
                        copay_amount: 0,
                    });
                    const nextStation = await nextStationForInvoice(inv.id, inv.patient_id);
                    await updatePatientStatus(inv.patient_id, nextStation);
                    done += 1;
                }
                catch (e) {
                    // keep going — one bad invoice must not block the rest
                }
            }
            await refreshInvoices();
            await refreshPatients?.();
            toast.success(`${done} fully covered invoice${done === 1 ? '' : 's'} sent to Claims`);
        }
        finally {
            setBulkBusy(false);
        }
    };
    const selectedPatient = selected
        ? patients.find((p) => p.id === selected.patient_id)
        : null;
    // Wallet only exists for cash patients — sponsored/insured never touch it.
    const walletEligible = selectedPatient ? hasWallet(selectedPatient) : false;
    const patientBalance = walletEligible ? Number(selectedPatient?.balance ?? 0) : 0;
    const availableBalance = Math.max(patientBalance, 0);
    const debtEligible = !!selectedPatient && walletEligible &&
        DEBT_ELIGIBLE.has(String(selectedPatient.account_type ?? '').toLowerCase());
    const invoiceTotal = selected ? Number(selected.total_amount) : 0;
    const alreadyPaid = selected ? Number(selected.paid_amount) : 0;
    // Sponsor split — only meaningful when the patient is insured/sponsored.
    const sponsored = selectedPatient ? isSponsored(selectedPatient) : false;
    const split = selectedPatient
        ? splitInvoice(invoiceTotal, selectedPatient)
        : { copayPct: 100, copayAmount: invoiceTotal, coveredAmount: 0 };
    // For sponsored patients the cashier only ever collects the copay portion;
    // the sponsor share is auto-settled and routed to the Claims queue.
    const outstanding = sponsored
        ? Math.max(split.copayAmount - alreadyPaid, 0)
        : Math.max(invoiceTotal - alreadyPaid, 0);
    const fullCover = sponsored && split.copayAmount === 0;
    const cash = Math.max(Number(cashAmount) || 0, 0);
    const pos = Math.max(Number(posAmount) || 0, 0);
    const transfer = Math.max(Number(transferAmount) || 0, 0);
    const bal = useBalance ? Math.max(Number(balanceAmount) || 0, 0) : 0;
    const salDed = isSalaryDeduction ? Math.max(Number(salaryDeductionAmount) || 0, 0) : 0;
    const applied = cash + pos + transfer + bal + salDed;
    const shortfall = Math.max(outstanding - applied, 0);
    const overpay = Math.max(applied - outstanding, 0);
    const balExceedsAvail = bal > availableBalance;
    const openPayment = (inv) => {
        setSelected(inv);
        const p = patients.find((pp) => pp.id === inv.patient_id);
        const spon = p ? isSponsored(p) : false;
        const s = p
            ? splitInvoice(Number(inv.total_amount), p)
            : { copayAmount: Number(inv.total_amount) - Number(inv.paid_amount) };
        const out = spon
            ? Math.max(s.copayAmount - Number(inv.paid_amount), 0)
            : Number(inv.total_amount) - Number(inv.paid_amount);
        setCashAmount(String(out));
        setMethod('cash');
        setPosAmount('');
        setTransferAmount('');
        setUseBalance(false);
        setBalanceAmount('');
        setIsSalaryDeduction(false);
        setSalaryDeductionAmount('');
    };
    // When user toggles "use balance", auto-suggest amounts
    useEffect(() => {
        if (!selected)
            return;
        if (useBalance) {
            const useFromBal = Math.min(availableBalance, outstanding);
            setBalanceAmount(String(useFromBal));
            setCashAmount(String(Math.max(outstanding - useFromBal, 0)));
        }
        else {
            setBalanceAmount('');
            setCashAmount(String(outstanding));
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [useBalance, selected?.id]);
    const submit = async () => {
        if (!selected || !selectedPatient)
            return;
        // Full-cover sponsored invoice — nothing to collect, just settle & send.
        if (fullCover) {
            setBusy(true);
            try {
                const remaining = invoiceTotal - alreadyPaid;
                await settleInvoiceAsPaid(selected.id, alreadyPaid, // nothing new collected from patient — sponsor fully covers
                'sponsor_claim', `Sponsor fully covered · ${sponsorLabel(selectedPatient)}`);
                await refreshInvoices();
                await paymentAuditLogger('payment_received', selected.invoice_number, {
                    patient_id: selected.patient_id,
                    patient_name: `${selectedPatient.first_name} ${selectedPatient.last_name}`,
                    action: 'sponsor_fully_covered',
                    sponsor: sponsorLabel(selectedPatient),
                    covered_amount: remaining,
                    copay_amount: 0,
                });
                const nextStation = await nextStationForInvoice(selected.id, selected.patient_id);
                await updatePatientStatus(selected.patient_id, nextStation);
                toast.success('Acknowledged — sent to Claims', {
                    description: `${selected.invoice_number} · Sponsor covers ₦${remaining.toLocaleString()} · ${`Patient routed to ${workflowStationLabel(nextStation)}`}`,
                });
                setReceipt({
                    patient: selectedPatient,
                    amount: 0,
                    paymentMethod: 'sponsor_claim',
                    receiptNumber: selected.invoice_number,
                    date: new Date(),
                    newBalance: patientBalance,
                    breakdown: {
                        invoiceNumber: selected.invoice_number,
                        invoiceTotal,
                        sponsorCovered: invoiceTotal,
                        patientCopay: 0,
                        sponsorLabel: sponsorLabel(selectedPatient),
                        copayPct: 0,
                    },
                });
                setSelected(null);
            }
            catch (err) {
                toast.error(err?.message || 'Failed to acknowledge');
            }
            finally {
                setBusy(false);
            }
            return;
        }
        if (applied < 0) {
            toast.error('Invalid amount entered');
            return;
        }
        if (overpay > 0 && sponsored) {
            // Overpayment is credited to wallet for cash patients, 
            // but for sponsored patients we only ever collect up to the copay.
            toast.error('Total exceeds patient copay');
            return;
        }
        if (bal > 0 && balExceedsAvail) {
            toast.error(`Only ₦${availableBalance.toLocaleString()} available on balance`);
            return;
        }
        if (!sponsored && shortfall > 0 && !debtEligible) {
            toast.error('This account type must be paid in full');
            return;
        }
        if (sponsored && shortfall > 0) {
            toast.error(`Collect the full copay of ₦${split.copayAmount.toLocaleString()} before sending to Claims`);
            return;
        }
        if (busy)
            return;
        setBusy(true);
        try {
            const breakdown = [];
            if (cash > 0)
                breakdown.push(`Cash: ${cash}`);
            if (pos > 0)
                breakdown.push(`POS: ${pos}`);
            if (transfer > 0)
                breakdown.push(`Transfer: ${transfer}`);
            const breakdownStr = breakdown.length > 0 ? ` (Breakdown: ${breakdown.join(', ')})` : '';
            const paymentMethod = applied === 0
                ? 'credit'
                : salDed > 0 && cash === 0 && pos === 0 && transfer === 0 && bal === 0
                    ? 'salary_deduction'
                    : sponsored
                        ? 'sponsor_claim'
                        : bal > 0 && cash === 0 && pos === 0 && transfer === 0
                            ? 'balance'
                            : 'split'; // Multi-mode payment
            const notes = salDed > 0
                ? `Salary deduction of ₦${salDed.toLocaleString()} recorded · ${sponsorLabel(selectedPatient)}`
                : sponsored
                    ? `Copay collected; sponsor claim routed to Claims · ${sponsorLabel(selectedPatient)}`
                    : shortfall > 0
                        ? (applied === 0
                            ? `Patient bought on credit (₦${shortfall.toLocaleString()} added to debt)`
                            : `Short payment — ₦${shortfall.toLocaleString()} moved to patient debt`)
                        : undefined;
            const debt = !sponsored && shortfall > 0 ? shortfall : 0;
            const combinedCash = cash + pos + transfer;
            const result = await settleInvoiceAtomic({
                invoiceId: selected.id,
                cashAmount: combinedCash,
                balanceAmount: bal,
                debtAmount: debt,
                paymentMethod,
                notes: (notes || '') + (applied > 0 ? breakdownStr : ''),
                sponsored,
                isSalaryDeduction: salDed > 0,
            });
            // Update patient balance in context immediately for instant UI feedback
            if (result?.new_wallet_balance !== undefined && typeof updatePatient === 'function') {
                updatePatient(selected.patient_id, { balance: result.new_wallet_balance });
            }
            await refreshInvoices();
            await paymentAuditLogger('payment_received', selected.invoice_number, {
                patient_id: selected.patient_id,
                patient_name: `${selectedPatient.first_name} ${selectedPatient.last_name}`,
                action: salDed > 0
                    ? 'salary_deduction_recorded'
                    : sponsored
                        ? 'copay_recorded_sponsor_billed'
                        : shortfall > 0
                            ? 'payment_recorded_with_debt'
                            : 'payment_recorded',
                sponsor: (sponsored || isSalaryDeduction) ? sponsorLabel(selectedPatient) : null,
                cash_amount: cash,
                pos_amount: pos,
                transfer_amount: transfer,
                balance_amount: bal,
                is_salary_deduction: salDed > 0,
                salary_deduction_amount: salDed,
                copay_amount: sponsored ? (salDed + cash + bal) : undefined,
                covered_amount: sponsored ? Math.max(invoiceTotal - split.copayAmount, 0) : undefined,
                method,
                shortfall: sponsored ? 0 : shortfall,
            });
            // Route the patient to the correct next station based on what was billed
            // (lab tests → back to Lab; meds/other → Pharmacy).
            // If it's a custom bill (no linked snaps), nextStation will be null, and we do NOT update status.
            const nextStation = await nextStationForInvoice(selected.id, selected.patient_id);
            if (nextStation) {
                await updatePatientStatus(selected.patient_id, nextStation);
            }
            const parts = [];
            if (cash > 0)
                parts.push(`₦${cash.toLocaleString()} Cash`);
            if (pos > 0)
                parts.push(`₦${pos.toLocaleString()} POS`);
            if (transfer > 0)
                parts.push(`₦${transfer.toLocaleString()} Transfer`);
            if (bal > 0)
                parts.push(`₦${bal.toLocaleString()} Balance`);
            if (salDed > 0)
                parts.push(`₦${salDed.toLocaleString()} Salary Deduction`);
            if (!sponsored && shortfall > 0)
                parts.push(`₦${shortfall.toLocaleString()} owed on balance`);
            if (!sponsored && overpay > 0)
                parts.push(`₦${overpay.toLocaleString()} credited to wallet`);
            if (sponsored)
                parts.push(`sponsor ₦${(invoiceTotal - split.copayAmount).toLocaleString()} → Claims`);
            const successMessage = salDed > 0 && cash === 0 && bal === 0
                ? 'Salary deduction recorded'
                : sponsored
                    ? 'Copay collected — sent to Claims'
                    : overpay > 0
                        ? 'Payment recorded with change to wallet'
                        : shortfall > 0
                            ? (applied === 0 ? 'Recorded as debt (Credit)' : 'Partial payment recorded')
                            : 'Payment recorded';
            toast.success(successMessage, { description: `${selected.invoice_number} · ${parts.join(' + ')} · routed to ${workflowStationLabel(nextStation)}` });
            // Open printable receipt with a clean breakdown.
            setReceipt({
                patient: selectedPatient,
                amount: cash + pos + transfer + bal,
                paymentMethod: applied === 0 ? 'credit' : paymentMethod,
                receiptNumber: selected.invoice_number,
                date: new Date(),
                newBalance: Number(patientBalance) - bal - (!sponsored && shortfall > 0 ? shortfall : 0),
                breakdown: {
                    invoiceNumber: selected.invoice_number,
                    invoiceTotal,
                    sponsorCovered: sponsored ? split.coveredAmount : 0,
                    patientCopay: sponsored ? split.copayAmount : invoiceTotal,
                    sponsorLabel: sponsored ? sponsorLabel(selectedPatient) : null,
                    copayPct: sponsored ? split.copayPct : 100,
                    owedAfter: !sponsored && shortfall > 0 ? shortfall : 0,
                },
            });
            setSelected(null);
            setCashAmount('');
            setPosAmount('');
            setTransferAmount('');
            setBalanceAmount('');
            setUseBalance(false);
            setSalaryDeductionAmount('');
            setIsSalaryDeduction(false);
        }
        catch (err) {
            toast.error(err?.message || 'Failed to record payment');
        }
        finally {
            setBusy(false);
        }
    };
    return (_jsxs("div", { className: "bg-card rounded-xl border border-border p-4", children: [
            _jsxs("div", { className: "flex items-center justify-between mb-3", children: [
                    _jsxs("h3", { className: "font-semibold flex items-center gap-2", children: [
                            _jsx(Wallet, { className: "h-4 w-4 text-module-billing" }),
                            "Cashier \u00B7 Record Payment"] }), _jsx(Badge, { variant: "warning", children: pending.length })
                ] }), _jsxs("div", { className: "relative mb-3", children: [
                    _jsx(Search, { className: "h-3.5 w-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" }), _jsx(Input, { value: query, onChange: (e) => setQuery(e.target.value), placeholder: "Search invoice # or patient\u2026", className: "h-8 pl-7 text-sm" })
                ] }), _jsxs("div", { className: "flex flex-wrap items-center gap-1.5 mb-3", children: [[
                        { k: 'all', label: `All (${pending.length})` },
                        { k: 'copay', label: `Copay due (${pending.length - coveredRows.length})` },
                        { k: 'covered', label: `Fully covered (${coveredRows.length})` },
                    ].map(({ k, label }) => (_jsx(Button, { size: "sm", variant: filter === k ? 'default' : 'outline', className: "h-7 text-xs", onClick: () => setFilter(k), children: label }, k))), coveredRows.length > 0 && (_jsxs(Button, { size: "sm", variant: "secondary", className: "h-7 text-xs ml-auto", disabled: bulkBusy, onClick: clearFullyCovered, children: [
                            _jsx(Send, { className: "h-3.5 w-3.5 mr-1" }), bulkBusy ? 'Clearing…' : 'Clear fully covered'] }))] }), _jsxs("div", { className: "space-y-2 max-h-[360px] overflow-y-auto", children: [rows.length === 0 && (_jsx("p", { className: "text-sm text-muted-foreground text-center py-6", children: "No unpaid invoices" })), rows.map(({ inv, patient }) => {
                        const spon = patient ? isSponsored(patient) : false;
                        const s = patient
                            ? splitInvoice(Number(inv.total_amount), patient)
                            : { copayPct: 100, copayAmount: Number(inv.total_amount), coveredAmount: 0 };
                        const rowOut = spon
                            ? Math.max(s.copayAmount - Number(inv.paid_amount), 0)
                            : Number(inv.total_amount) - Number(inv.paid_amount);
                        const bal = Number(patient?.balance ?? 0);
                        const rowFull = spon && s.copayAmount === 0;
                        return (_jsxs("div", { className: "p-3 rounded-lg border border-border hover:border-module-billing/50 transition-all", children: [
                                _jsxs("div", { className: "flex items-center justify-between mb-1", children: [
                                        _jsx("span", { className: "font-mono text-[11px] text-muted-foreground", children: inv.invoice_number }), _jsxs("div", { className: "flex items-center gap-1", children: [spon && (_jsxs(Badge, { variant: "info", className: "text-[10px]", children: [
                                                        _jsx(Shield, { className: "h-2.5 w-2.5 mr-0.5" }), sponsorLabel(patient), " \u00B7 ", s.copayPct, "%"] })), _jsx(Badge, { variant: inv.status === 'partial' ? 'warning' : 'outline', className: "text-[10px]", children: inv.status })
                                            ] })
                                    ] }), _jsx("p", { className: "font-medium text-sm truncate", children: patient ? `${patient.first_name} ${patient.last_name}` : 'Unknown patient' }), _jsxs("p", { className: "text-[11px] text-muted-foreground", children: [patient?.card_number, patient && hasWallet(patient) && (_jsxs(_Fragment, { children: [' · Balance ', _jsxs("span", { className: bal < 0 ? 'text-destructive font-semibold' : bal > 0 ? 'text-success font-semibold' : '', children: ["\u20A6", bal.toLocaleString()] })
                                            ] }))] }), spon ? (_jsxs("div", { className: "mt-1.5 grid grid-cols-3 gap-1 text-[10px] rounded-md border border-border/60 bg-muted/40 p-1.5", children: [
                                        _jsxs("div", { children: [
                                                _jsx("div", { className: "text-muted-foreground", children: "Total" }), _jsxs("div", { className: "font-semibold", children: ["\u20A6", Number(inv.total_amount).toLocaleString()] })
                                            ] }), _jsxs("div", { children: [
                                                _jsx("div", { className: "text-muted-foreground", children: "Sponsor" }), _jsxs("div", { className: "font-semibold text-primary", children: ["\u20A6", s.coveredAmount.toLocaleString()] })
                                            ] }), _jsxs("div", { children: [
                                                _jsxs("div", { className: "text-muted-foreground", children: ["Copay (", s.copayPct, "%)"] }), _jsxs("div", { className: "font-semibold", children: ["\u20A6", s.copayAmount.toLocaleString()] })
                                            ] })
                                    ] })) : (_jsxs("p", { className: "text-[11px] text-muted-foreground mt-0.5", children: ["Total \u20A6", Number(inv.total_amount).toLocaleString()] })), _jsxs("div", { className: "mt-2 flex items-center justify-between gap-2", children: [
                                        _jsxs("div", { className: "text-xs", children: [
                                                _jsxs("span", { className: "text-muted-foreground", children: [spon ? (rowFull ? 'Copay' : 'Copay due') : 'Owing', ' '] }), _jsx("span", { className: `font-bold ${rowFull ? 'text-success' : 'text-destructive'}`, children: rowFull ? '₦0 (full cover)' : `₦${rowOut.toLocaleString()}` })
                                            ] }), _jsxs(Button, { size: "sm", onClick: () => openPayment(inv), className: "h-7", children: [rowFull ? _jsx(Send, { className: "h-3.5 w-3.5 mr-1" }) : _jsx(Banknote, { className: "h-3.5 w-3.5 mr-1" }), rowFull ? 'Acknowledge' : 'Record'] })
                                    ] })
                            ] }, inv.id));
                    })] }), unavailableItems.length > 0 && (_jsxs("div", { className: "mt-6 pt-6 border-t border-border", children: [
                    _jsxs("div", { className: "flex items-center justify-between mb-3", children: [
                            _jsxs("h4", { className: "text-sm font-semibold flex items-center gap-2 text-destructive", children: [
                                    _jsx(AlertTriangle, { className: "h-4 w-4" }),
                                    "Pending Refunds / Adjustments"] }), _jsx(Badge, { variant: "destructive", className: "animate-pulse", children: unavailableItems.length })
                        ] }), _jsx("div", { className: "space-y-2", children: unavailableItems.map((item) => {
                            const patient = patients.find((p) => p.id === item.invoice.patient_id);
                            const spon = patient ? isSponsored(patient) : false;
                            const fullCoverInsurance = spon && copayPercent(patient) === 0;
                            return (_jsxs("div", { className: "p-3 rounded-lg border border-destructive/20 bg-destructive/5 flex items-center justify-between gap-3", children: [
                                    _jsxs("div", { className: "min-w-0 flex-1", children: [
                                            _jsx("p", { className: "text-sm font-medium truncate", children: patient ? `${patient.first_name} ${patient.last_name}` : 'Unknown Patient' }), _jsxs("p", { className: "text-[11px] text-muted-foreground truncate", children: [item.description, " \u00B7 ",
                                                    _jsx("span", { className: "font-mono", children: item.invoice.invoice_number })
                                                ] }), _jsx("p", { className: "text-[10px] font-semibold text-destructive mt-0.5", children: fullCoverInsurance ? 'REMOVAL FROM CLAIM' : `REFUND: ₦${(Number(item.total) || 0).toLocaleString()}` })
                                        ] }), _jsx(Button, { size: "sm", variant: "destructive", className: "h-7 text-xs shrink-0", onClick: () => setRefundItem({ item, invoice: item.invoice }), children: "Process" })
                                ] }, item.id));
                        }) })
                ] })), _jsx(Dialog, { open: !!selected, onOpenChange: (o) => !o && setSelected(null), children: _jsxs(DialogContent, { className: "sm:max-w-md", children: [
                        _jsxs(DialogHeader, { children: [
                                _jsx(DialogTitle, { children: fullCover ? 'Acknowledge Sponsored Invoice' : 'Record Payment' }), _jsxs(DialogDescription, { children: [selected?.invoice_number, " \u00B7", ' ', sponsored ? (_jsxs(_Fragment, { children: ["Copay due", ' ', _jsxs("span", { className: "font-semibold text-destructive", children: ["\u20A6", outstanding.toLocaleString()] }), ' ', _jsxs("span", { className: "text-muted-foreground", children: ["(of \u20A6", invoiceTotal.toLocaleString(), " total)"] })
                                            ] })) : (_jsxs(_Fragment, { children: ["Outstanding", ' ', _jsxs("span", { className: "font-semibold text-destructive", children: ["\u20A6", outstanding.toLocaleString()] })
                                            ] })), selectedPatient && walletEligible && (_jsxs("span", { className: "block text-xs mt-1", children: [selectedPatient.first_name, " ", selectedPatient.last_name, " \u00B7", ' ', _jsx("span", { className: "capitalize", children: selectedPatient.account_type }),
                                                " \u00B7 Balance", ' ', _jsxs("span", { className: patientBalance < 0
                                                        ? 'text-destructive font-semibold'
                                                        : patientBalance > 0
                                                            ? 'text-success font-semibold'
                                                            : '', children: ["\u20A6", patientBalance.toLocaleString()] })
                                            ] })), selectedPatient && !walletEligible && (_jsxs("span", { className: "block text-xs mt-1", children: [selectedPatient.first_name, " ", selectedPatient.last_name, " \u00B7", ' ', _jsx("span", { className: "capitalize", children: selectedPatient.account_type?.replace('_', ' ') })
                                            ] }))] })
                            ] }), _jsxs("div", { className: "space-y-3", children: [sponsored && (_jsxs("div", { className: "rounded-lg border border-primary/40 bg-primary/5 p-3 text-xs space-y-1", children: [
                                        _jsxs("div", { className: "flex items-center gap-1.5 font-semibold text-primary", children: [
                                                _jsx(Shield, { className: "h-3.5 w-3.5" }), sponsorLabel(selectedPatient), " \u00B7 Copay ", split.copayPct, "%"] }), _jsxs("div", { className: "flex justify-between", children: [
                                                _jsx("span", { className: "text-muted-foreground", children: "Invoice total" }), _jsxs("span", { className: "font-semibold", children: ["\u20A6", invoiceTotal.toLocaleString()] })
                                            ] }), _jsxs("div", { className: "flex justify-between", children: [
                                                _jsxs("span", { className: "text-muted-foreground", children: ["Sponsor covers (", 100 - split.copayPct, "%)"] }), _jsxs("span", { className: "font-semibold text-primary", children: ["\u20A6", split.coveredAmount.toLocaleString()] })
                                            ] }), _jsxs("div", { className: "flex justify-between border-t border-primary/20 pt-1", children: [
                                                _jsxs("span", { className: "text-muted-foreground", children: ["Patient copay (", split.copayPct, "%)"] }), _jsxs("span", { className: "font-bold", children: ["\u20A6", split.copayAmount.toLocaleString()] })
                                            ] }), _jsx("p", { className: "pt-1 text-[11px] text-muted-foreground", children: fullCover
                                                ? 'No cash to collect. Acknowledge to send the invoice to the Claims queue.'
                                                : 'Collect only the copay. The sponsor portion is auto-routed to Claims after settle.' })
                                    ] })), !fullCover && (_jsxs("div", { className: "space-y-4 border-t border-border pt-4", children: [
                                        _jsxs("div", { className: "grid grid-cols-1 md:grid-cols-3 gap-3", children: [
                                                _jsxs("div", { className: "space-y-1.5", children: [
                                                        _jsxs(Label, { className: "text-[11px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5", children: [
                                                                _jsx(Banknote, { className: "h-3.5 w-3.5 text-success" }),
                                                                "Cash (\u20A6)"] }), _jsx(Input, { type: "number", value: cashAmount, onChange: (e) => setCashAmount(e.target.value), placeholder: "0", className: "h-10 border-success/30 focus-visible:ring-success" })
                                                    ] }), _jsxs("div", { className: "space-y-1.5", children: [
                                                        _jsxs(Label, { className: "text-[11px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5", children: [
                                                                _jsx(Shield, { className: "h-3.5 w-3.5 text-blue-500" }),
                                                                "POS/Card (\u20A6)"] }), _jsx(Input, { type: "number", value: posAmount, onChange: (e) => setPosAmount(e.target.value), placeholder: "0", className: "h-10 border-blue-500/30 focus-visible:ring-blue-500" })
                                                    ] }), _jsxs("div", { className: "space-y-1.5", children: [
                                                        _jsxs(Label, { className: "text-[11px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5", children: [
                                                                _jsx(Send, { className: "h-3.5 w-3.5 text-purple-500" }),
                                                                "Transfer (\u20A6)"] }), _jsx(Input, { type: "number", value: transferAmount, onChange: (e) => setTransferAmount(e.target.value), placeholder: "0", className: "h-10 border-purple-500/30 focus-visible:ring-purple-500" })
                                                    ] })
                                            ] }), walletEligible && (_jsxs("div", { className: `p-3 rounded-lg border transition-all ${useBalance ? 'bg-success/5 border-success/40' : 'bg-muted/30 border-border'}`, children: [
                                                _jsxs("label", { className: "flex items-center gap-2 cursor-pointer mb-2", children: [
                                                        _jsx(Checkbox, { checked: useBalance, onCheckedChange: (v) => setUseBalance(!!v) }), _jsx(PiggyBank, { className: "h-4 w-4 text-success" }), _jsx("span", { className: "text-xs font-bold uppercase tracking-wider", children: "Use Wallet Balance" })
                                                    ] }), useBalance && (_jsx("div", { className: "flex items-center gap-3 animate-in fade-in slide-in-from-top-1 duration-200", children: _jsxs("div", { className: "flex-1", children: [
                                                            _jsxs("p", { className: "text-[10px] text-muted-foreground mb-1 uppercase font-semibold", children: ["Available: \u20A6", availableBalance.toLocaleString()] }), _jsx(Input, { type: "number", value: balanceAmount, onChange: (e) => setBalanceAmount(e.target.value), max: Math.min(availableBalance, outstanding), className: "h-9 border-success/30" }), balExceedsAvail && (_jsx("p", { className: "text-[10px] text-destructive mt-1 font-medium", children: "Exceeds balance" }))] }) }))] }))] })), selectedPatient?.account_type === 'staff_family' && (_jsx("div", { className: `p-3 rounded-lg border transition-all ${isSalaryDeduction ? 'bg-warning/5 border-warning/40' : 'bg-muted/30 border-border'}`, children: _jsxs("div", { className: "flex items-start justify-between gap-4", children: [
                                            _jsxs("div", { className: "flex-1", children: [
                                                    _jsxs("label", { className: "flex items-center gap-2 cursor-pointer mb-1", children: [
                                                            _jsx(Checkbox, { checked: isSalaryDeduction, onCheckedChange: (v) => {
                                                                    setIsSalaryDeduction(!!v);
                                                                    if (v) {
                                                                        setSalaryDeductionAmount(String(outstanding));
                                                                        setCashAmount('0');
                                                                        setPosAmount('0');
                                                                        setTransferAmount('0');
                                                                        setUseBalance(false);
                                                                        setBalanceAmount('0');
                                                                    }
                                                                    else {
                                                                        setSalaryDeductionAmount('');
                                                                        setCashAmount(String(outstanding));
                                                                    }
                                                                }, className: "border-warning/50 data-[state=checked]:bg-warning data-[state=checked]:text-warning-foreground" }), _jsxs("span", { className: "text-xs font-bold uppercase tracking-wider flex items-center gap-1.5", children: [
                                                                    _jsx(Banknote, { className: "h-4 w-4 text-warning" }),
                                                                    "Sponsor Salary Deduction"] })
                                                        ] }), _jsx("p", { className: "text-[10px] text-muted-foreground ml-6 leading-tight", children: "Staff Family members get a 50% discount. Deduct the remaining 50% from the sponsor's salary." })
                                                ] }), isSalaryDeduction && (_jsxs("div", { className: "w-32 animate-in fade-in slide-in-from-right-1 duration-200", children: [
                                                    _jsxs("p", { className: "text-[10px] text-muted-foreground mb-1 uppercase font-semibold text-right", children: ["Max: \u20A6", outstanding.toLocaleString()] }), _jsx(Input, { type: "number", value: salaryDeductionAmount, onChange: (e) => {
                                                            const val = Number(e.target.value);
                                                            setSalaryDeductionAmount(e.target.value);
                                                            if (val <= outstanding) {
                                                                setCashAmount(String(outstanding - val));
                                                            }
                                                        }, className: "h-9 border-warning/30 focus-visible:ring-warning" })
                                                ] }))] }) })), !fullCover && (_jsxs("div", { className: "rounded-lg bg-muted/40 p-3 text-xs space-y-1", children: [
                                        _jsxs("div", { className: "flex justify-between", children: [
                                                _jsx("span", { className: "text-muted-foreground", children: sponsored ? 'Copay due' : 'Outstanding' }), _jsxs("span", { className: "font-semibold", children: ["\u20A6", outstanding.toLocaleString()] })
                                            ] }), salDed > 0 && (_jsxs("div", { className: "flex justify-between text-warning font-medium", children: [
                                                _jsx("span", { children: "Salary Deduction" }), _jsxs("span", { children: ["\u2212 \u20A6", salDed.toLocaleString()] })
                                            ] })), bal > 0 && (_jsxs("div", { className: "flex justify-between text-success font-medium", children: [
                                                _jsx("span", { children: "From balance" }), _jsxs("span", { children: ["\u2212 \u20A6", bal.toLocaleString()] })
                                            ] })), cash > 0 && (_jsxs("div", { className: "flex justify-between text-[11px] text-muted-foreground", children: [
                                                _jsx("span", { children: "Cash" }), _jsxs("span", { children: ["\u2212 \u20A6", cash.toLocaleString()] })
                                            ] })), pos > 0 && (_jsxs("div", { className: "flex justify-between text-[11px] text-muted-foreground", children: [
                                                _jsx("span", { children: "POS / Card" }), _jsxs("span", { children: ["\u2212 \u20A6", pos.toLocaleString()] })
                                            ] })), transfer > 0 && (_jsxs("div", { className: "flex justify-between text-[11px] text-muted-foreground", children: [
                                                _jsx("span", { children: "Bank Transfer" }), _jsxs("span", { children: ["\u2212 \u20A6", transfer.toLocaleString()] })
                                            ] })), _jsxs("div", { className: "flex justify-between pt-1 border-t border-border", children: [
                                                _jsx("span", { className: "font-semibold", children: shortfall > 0
                                                        ? sponsored
                                                            ? 'Copay short by'
                                                            : 'Owed after this payment'
                                                        : overpay > 0
                                                            ? 'Overpayment'
                                                            : 'Settled' }), _jsxs("span", { className: `font-bold ${shortfall > 0
                                                        ? 'text-destructive'
                                                        : overpay > 0
                                                            ? 'text-warning'
                                                            : 'text-success'}`, children: ["\u20A6", (shortfall || overpay).toLocaleString()] })
                                            ] })
                                    ] })), !sponsored && shortfall > 0 && (_jsxs("div", { className: "rounded-lg border border-warning/40 bg-warning/10 p-3 space-y-2", children: [
                                        _jsxs("div", { className: "flex items-start gap-2", children: [
                                                _jsx(AlertTriangle, { className: "h-4 w-4 text-warning mt-0.5" }), _jsxs("div", { className: "text-xs", children: [
                                                        _jsxs("p", { className: "font-semibold text-warning-foreground", children: ["Partial payment \u00B7 \u20A6", applied.toLocaleString(), " of \u20A6", outstanding.toLocaleString()] }), debtEligible ? (_jsxs("p", { className: "text-muted-foreground mt-0.5", children: ["The remaining ",
                                                                _jsxs("span", { className: "font-semibold", children: ["\u20A6", shortfall.toLocaleString()] }),
                                                                " will sit on the patient's balance as amount owed. New balance after this: \u20A6", (patientBalance - bal - shortfall).toLocaleString(), ". Any future top-up clears it automatically."] })) : (_jsx("p", { className: "text-destructive mt-0.5", children: "This account type cannot carry a balance owed \u2014 collect the full amount." }))] })
                                            ] }), debtEligible && (_jsxs("p", { className: "text-[11px] text-muted-foreground italic", children: ["Confirm to accept \u20A6", applied.toLocaleString(), " now and record \u20A6", shortfall.toLocaleString(), " as owed on the patient's balance."] }))] }))] }), _jsxs(DialogFooter, { children: [
                                _jsx(Button, { variant: "ghost", onClick: () => setSelected(null), disabled: busy, children: "Cancel" }), _jsx(Button, { onClick: submit, disabled: busy ||
                                        (!fullCover && applied < 0) ||
                                        (sponsored && overpay > 0) ||
                                        balExceedsAvail ||
                                        (sponsored && !fullCover && shortfall > 0) ||
                                        (!sponsored && shortfall > 0 && !debtEligible), children: busy
                                        ? 'Recording…'
                                        : fullCover
                                            ? 'Acknowledge & Send to Claims'
                                            : salDed > 0 && salDed === outstanding
                                                ? 'Confirm Salary Deduction'
                                                : salDed > 0
                                                    ? 'Confirm Mixed Payment'
                                                    : sponsored
                                                        ? 'Collect Copay & Send to Claims'
                                                        : shortfall > 0
                                                            ? applied === 0
                                                                ? 'Confirm ₦0 (Buy on Credit)'
                                                                : `Confirm ₦${applied.toLocaleString()} Partial Payment`
                                                            : 'Confirm Payment' })
                            ] })
                    ] }) }), receipt && (_jsx(PrintableReceiptDialog, { open: !!receipt, onOpenChange: (o) => !o && setReceipt(null), patient: receipt.patient, amount: receipt.amount, paymentMethod: receipt.paymentMethod, receiptNumber: receipt.receiptNumber, date: receipt.date, newBalance: receipt.newBalance, breakdown: receipt.breakdown })), refundItem && (_jsx(Dialog, { open: true, onOpenChange: (o) => !o && setRefundItem(null), children: _jsxs(DialogContent, { className: "sm:max-w-md", children: [
                        _jsxs(DialogHeader, { children: [
                                _jsx(DialogTitle, { children: "Process Refund" }), _jsxs(DialogDescription, { children: ["Refund \u20A6", (Number(refundItem.item.total) || 0).toLocaleString(), " for \"", refundItem.item.description, "\" to ", patients.find((p) => p.id === refundItem.invoice.patient_id)?.first_name, "."] })
                            ] }), _jsxs("div", { className: "p-4 bg-muted rounded-lg text-sm space-y-2", children: [
                                _jsxs("div", { className: "flex justify-between", children: [
                                        _jsx("span", { className: "text-muted-foreground", children: "Original Invoice:" }), _jsx("span", { className: "font-mono font-medium", children: refundItem.invoice.invoice_number })
                                    ] }), _jsxs("div", { className: "flex justify-between", children: [
                                        _jsx("span", { className: "text-muted-foreground", children: "Unavailable Reason:" }), _jsx("span", { className: "italic text-red-600", children: refundItem.item.dispensing_notes || 'Not specified' })
                                    ] })
                            ] }), _jsxs(DialogFooter, { className: "flex-col sm:flex-row gap-2", children: [
                                _jsx(Button, { variant: "ghost", className: "w-full sm:w-auto", onClick: () => setRefundItem(null), disabled: busy, children: "Cancel" }), isSponsored(patients.find((p) => p.id === refundItem.invoice.patient_id) || {}) && copayPercent(patients.find((p) => p.id === refundItem.invoice.patient_id) || {}) === 0 ? (_jsx(Button, { variant: "destructive", className: "w-full sm:flex-1", onClick: () => handleRefund('cash'), disabled: busy, children: busy ? 'Processing...' : 'Remove from Invoice & Claim' })) : isSponsored(patients.find((p) => p.id === refundItem.invoice.patient_id) || {}) ? (_jsx(Button, { variant: "destructive", className: "w-full sm:flex-1", onClick: () => handleRefund('cash'), disabled: busy, children: busy ? 'Processing...' : 'Void from Claim' })) : (_jsxs(_Fragment, { children: [
                                        _jsx(Button, { variant: "outline", className: "w-full sm:w-auto", onClick: () => handleRefund('cash'), disabled: busy, children: "Refund as Cash" }), _jsx(Button, { className: "w-full sm:flex-1", onClick: () => handleRefund('balance'), disabled: busy, children: busy ? 'Processing...' : 'Add to Wallet Balance' })
                                    ] }))] })
                    ] }) }))] }));
}
