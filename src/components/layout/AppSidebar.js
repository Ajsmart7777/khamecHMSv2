import { Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { HOSPITAL_LOGO } from '@/lib/hospital';
import { useState, useMemo } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { LayoutDashboard, Users, Stethoscope, Activity, BedDouble, FlaskConical, Receipt, Pill, Wallet, ClipboardCheck, Shield, ChevronLeft, ChevronRight, LogOut, Settings, Bell, Download, FileText } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, } from '@/components/ui/alert-dialog';
const allMenuItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, path: '/', color: 'text-primary', roles: ['admin'] },
    { id: 'reception', label: 'Reception', icon: Users, path: '/reception', color: 'text-module-reception', roles: ['receptionist', 'admin'] },
    { id: 'nurse', label: 'Nurse Station', icon: Activity, path: '/nurse', color: 'text-module-nurse', roles: ['nurse', 'admin'] },
    { id: 'doctor1', label: 'Doctor 1', icon: Stethoscope, path: '/doctor?as=doctor1', color: 'text-module-doctor', roles: ['doctor1', 'admin'] },
    { id: 'doctor2', label: 'Doctor 2', icon: Stethoscope, path: '/doctor?as=doctor2', color: 'text-module-doctor', roles: ['doctor2', 'admin'] },
    { id: 'emr', label: 'EMR', icon: FileText, path: '/emr', color: 'text-primary', roles: ['doctor1', 'doctor2', 'nurse', 'lab_tech', 'pharmacist', 'admin'] },
    { id: 'admitted', label: 'Admitted Patients', icon: BedDouble, path: '/admitted-patients', color: 'text-module-nurse', roles: ['doctor1', 'doctor2', 'nurse', 'admin'] },
    { id: 'lab', label: 'Laboratory', icon: FlaskConical, path: '/lab', color: 'text-module-lab', roles: ['lab_tech', 'admin'] },
    { id: 'billing', label: 'Billing', icon: Receipt, path: '/billing', color: 'text-module-billing', roles: ['billing', 'admin'] },
    { id: 'cashier', label: 'Cashier', icon: Receipt, path: '/cashier', color: 'text-module-billing', roles: ['cashier', 'admin'] },
    { id: 'pharmacy', label: 'Pharmacy', icon: Pill, path: '/pharmacy', color: 'text-module-pharmacy', roles: ['pharmacist', 'admin'] },
    { id: 'account', label: 'Accounts', icon: Wallet, path: '/account', color: 'text-module-account', roles: ['accountant', 'admin'] },
    { id: 'daily-sales', label: 'Daily Sales Report', icon: Wallet, path: '/daily-sales-report', color: 'text-module-account', roles: ['accountant', 'admin'] },
    { id: 'claims', label: 'Claims', icon: Shield, path: '/claims', color: 'text-module-billing', roles: ['claims_manager', 'admin'] },
    { id: 'auditing', label: 'Auditing', icon: ClipboardCheck, path: '/auditing', color: 'text-module-auditing', roles: ['admin'] },
    { id: 'admin', label: 'Admin', icon: Shield, path: '/admin', color: 'text-module-admin', roles: ['admin'] },
];
export function AppSidebar({ isMobile = false, onNavigate }) {
    const [collapsed, setCollapsed] = useState(false);
    const location = useLocation();
    const navigate = useNavigate();
    const { role, signOut } = useAuth();
    const [showLogoutDialog, setShowLogoutDialog] = useState(false);
    const menuItems = useMemo(() => {
        if (!role)
            return [allMenuItems[0]];
        return allMenuItems.filter(item => item.roles.includes(role));
    }, [role]);
    const handleLogout = async () => {
        await signOut();
        navigate('/auth');
    };
    const handleNavClick = () => {
        if (isMobile && onNavigate) {
            onNavigate();
        }
    };
    // For mobile, never collapse
    const isCollapsed = isMobile ? false : collapsed;
    return (_jsxs(_Fragment, { children: [
            _jsxs("aside", { className: cn("h-screen bg-sidebar flex flex-col", isMobile ? "w-full" : "fixed left-0 top-0 z-50 transition-all duration-300", !isMobile && (isCollapsed ? "w-20" : "w-64")), children: [
                    _jsxs("div", { className: "flex items-center gap-3 px-4 py-5 border-b border-sidebar-border", children: [
                            _jsx("img", { src: HOSPITAL_LOGO, alt: "Khadija Medical Center logo", className: "w-10 h-10 object-contain shrink-0" }), !isCollapsed && (_jsxs("div", { className: "animate-fade-in min-w-0", children: [
                                    _jsx("h1", { className: "font-bold text-sidebar-foreground text-sm truncate", children: "Khadija Medical" }), _jsx("p", { className: "text-xs text-sidebar-foreground/60", children: "HMS Funtua" })
                                ] }))] }), _jsx("nav", { className: "flex-1 py-4 px-3 overflow-y-auto", children: _jsx("ul", { className: "space-y-1", children: menuItems.map((item) => {
                                const [itemPath, itemQuery] = item.path.split('?');
                                const isActive = location.pathname === itemPath &&
                                    (itemQuery ? location.search.includes(itemQuery) : true);
                                const Icon = item.icon;
                                return (_jsx("li", { children: _jsxs(Link, { to: item.path, onClick: handleNavClick, className: cn("sidebar-item", isActive && "active", isCollapsed && "justify-center px-0"), title: isCollapsed ? item.label : undefined, children: [
                                            _jsx(Icon, { className: cn("h-5 w-5 shrink-0", isActive ? "text-inherit" : item.color) }), !isCollapsed && (_jsx("span", { className: "truncate animate-fade-in", children: item.label }))] }) }, item.id));
                            }) }) }), _jsxs("div", { className: "p-3 border-t border-sidebar-border space-y-2", children: [
                            _jsxs(Button, { variant: "ghost", size: "sm", className: cn("w-full text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent", isCollapsed && "px-0"), children: [
                                    _jsx(Bell, { className: "h-4 w-4" }), !isCollapsed && _jsx("span", { children: "Notifications" })] }), _jsx(Link, { to: "/settings", onClick: handleNavClick, children: _jsxs(Button, { variant: "ghost", size: "sm", className: cn("w-full text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent", isCollapsed && "px-0", location.pathname === '/settings' && "bg-sidebar-accent text-sidebar-foreground"), children: [
                                        _jsx(Settings, { className: "h-4 w-4" }), !isCollapsed && _jsx("span", { children: "Settings" })] }) }), _jsx(Link, { to: "/install", onClick: handleNavClick, children: _jsxs(Button, { variant: "ghost", size: "sm", className: cn("w-full text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent", isCollapsed && "px-0", location.pathname === '/install' && "bg-sidebar-accent text-sidebar-foreground"), children: [
                                        _jsx(Download, { className: "h-4 w-4" }), !isCollapsed && _jsx("span", { children: "Install App" })] }) }), _jsxs(Button, { variant: "ghost", size: "sm", onClick: () => setShowLogoutDialog(true), className: cn("w-full text-sidebar-foreground/70 hover:text-destructive hover:bg-destructive/10", isCollapsed && "px-0"), children: [
                                    _jsx(LogOut, { className: "h-4 w-4" }), !isCollapsed && _jsx("span", { children: "Logout" })] }), _jsx("div", { className: cn("px-3 py-2 text-[10px] text-sidebar-foreground/30 font-mono", isCollapsed && "text-center px-0"), children: isCollapsed ? `v${import.meta.env.VITE_APP_COMMIT_HASH}` : `Build: v${import.meta.env.VITE_APP_VERSION}.${import.meta.env.VITE_APP_COMMIT_HASH}` })
                        ] }), !isMobile && (_jsx("button", { onClick: () => setCollapsed(!collapsed), className: "absolute -right-3 top-20 w-6 h-6 bg-primary text-primary-foreground rounded-full flex items-center justify-center shadow-lg hover:bg-primary/90 transition-colors", children: isCollapsed ? _jsx(ChevronRight, { className: "h-3 w-3" }) : _jsx(ChevronLeft, { className: "h-3 w-3" }) }))] }), _jsx(AlertDialog, { open: showLogoutDialog, onOpenChange: setShowLogoutDialog, children: _jsxs(AlertDialogContent, { children: [
                        _jsxs(AlertDialogHeader, { children: [
                                _jsx(AlertDialogTitle, { children: "Confirm Logout" }), _jsx(AlertDialogDescription, { children: "Are you sure you want to log out? You will need to sign in again to access the system." })
                            ] }), _jsxs(AlertDialogFooter, { children: [
                                _jsx(AlertDialogCancel, { children: "Cancel" }), _jsx(AlertDialogAction, { onClick: handleLogout, children: "Logout" })
                            ] })
                    ] }) })
        ] }));
}
