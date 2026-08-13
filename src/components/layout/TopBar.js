import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Search, User, Calendar, Menu, Info } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { NotificationPanel } from '@/components/layout/NotificationPanel';
import { useAuth } from '@/contexts/AuthContext';
export function TopBar({ title, subtitle, onMenuClick, showMenuButton }) {
    const { user, role } = useAuth();
    const today = new Date().toLocaleDateString('en-NG', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });
    return (_jsx("header", { className: "sticky top-0 z-40 bg-background/80 backdrop-blur-md border-b border-border px-3 sm:px-4 md:px-6 py-3 md:py-4", children: _jsxs("div", { className: "flex items-center justify-between gap-2", children: [
                _jsxs("div", { className: "flex items-center gap-3 min-w-0", children: [showMenuButton && (_jsx(Button, { variant: "ghost", size: "icon", className: "lg:hidden shrink-0", onClick: onMenuClick, children: _jsx(Menu, { className: "h-5 w-5" }) })), _jsxs("div", { className: "min-w-0", children: [
                                _jsx("h1", { className: "text-lg sm:text-xl md:text-2xl font-bold text-foreground truncate", children: title }), subtitle && _jsx("p", { className: "text-xs sm:text-sm text-muted-foreground truncate", children: subtitle })] })
                    ] }), _jsxs("div", { className: "flex items-center gap-2 sm:gap-4 shrink-0", children: [
                        _jsxs(Tooltip, { children: [
                                _jsx(TooltipTrigger, { asChild: true, children: _jsxs("div", { className: "hidden sm:flex items-center gap-1 px-2 py-1 rounded bg-muted/30 border border-border text-[10px] text-muted-foreground font-mono cursor-help", children: [
                                            _jsx(Info, { className: "h-3 w-3" }), _jsxs("span", { children: ["v", import.meta.env.VITE_APP_VERSION, ".", import.meta.env.VITE_APP_COMMIT_HASH] })
                                        ] }) }), _jsxs(TooltipContent, { children: [
                                        _jsx("p", { children: "Khadija Medical Center HMS" }), _jsxs("p", { className: "text-[10px] text-muted-foreground", children: ["Build: ", import.meta.env.VITE_APP_COMMIT_HASH] })
                                    ] })
                            ] }), _jsxs("div", { className: "hidden md:flex items-center gap-2 text-sm text-muted-foreground", children: [
                                _jsx(Calendar, { className: "h-4 w-4" }), _jsx("span", { children: today })
                            ] }), _jsxs("div", { className: "relative hidden lg:block", children: [
                                _jsx(Search, { className: "absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" }), _jsx(Input, { placeholder: "Search patients, records...", className: "w-72 pl-10 bg-muted/50 border-0 focus-visible:ring-1" })
                            ] }), _jsx(NotificationPanel, {}), _jsxs("div", { className: "flex items-center gap-2 sm:gap-3 pl-2 sm:pl-4 border-l border-border", children: [
                                _jsxs("div", { className: "text-right hidden sm:block", children: [
                                        _jsx("p", { className: "text-sm font-medium", children: user?.email?.split('@')[0] || 'Staff' }), _jsx("p", { className: "text-xs text-muted-foreground capitalize", children: role || 'User' })
                                    ] }), _jsx("div", { className: "w-8 h-8 sm:w-10 sm:h-10 rounded-full bg-primary/10 flex items-center justify-center", children: _jsx(User, { className: "h-4 w-4 sm:h-5 sm:w-5 text-primary" }) })
                            ] })
                    ] })
            ] }) }));
}
