import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { lazy, Suspense } from "react";
import { PatientProvider } from "@/contexts/PatientContext";
import { AuthProvider } from "@/contexts/AuthContext";
import { SettingsProvider } from "@/contexts/SettingsContext";
import { AppErrorBoundary } from "@/components/system/AppErrorBoundary";

import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { RoleHome } from "@/components/auth/RoleHome";

// Route-level code splitting: each workspace page (and its heavy child
// components — PDF libs, dialogs, tables) loads on demand instead of shipping
// the entire HMS in one bundle that every tablet must download and parse.
const Index = lazy(() => import("./pages/Index"));
const Auth = lazy(() => import("./pages/Auth"));
const Reception = lazy(() => import("./pages/Reception"));
const NurseStation = lazy(() => import("./pages/NurseStation"));
const Doctor = lazy(() => import("./pages/Doctor"));
const Laboratory = lazy(() => import("./pages/Laboratory"));
const Billing = lazy(() => import("./pages/Billing"));
const BillingPricelist = lazy(() => import("./pages/BillingPricelist"));
const Cashier = lazy(() => import("./pages/Cashier"));
const Pharmacy = lazy(() => import("./pages/Pharmacy"));
const Store = lazy(() => import("./pages/Store"));
const Account = lazy(() => import("./pages/Account"));
const AccountPayroll = lazy(() => import("./pages/AccountPayroll"));
const Auditing = lazy(() => import("./pages/Auditing"));
const Admin = lazy(() => import("./pages/Admin"));
const Settings = lazy(() => import("./pages/Settings"));
const Install = lazy(() => import("./pages/Install"));
const NotFound = lazy(() => import("./pages/NotFound"));
const Claims = lazy(() => import("./pages/Claims"));
const EMR = lazy(() => import("./pages/EMR"));
const DailySalesReportPage = lazy(() => import("./pages/DailySalesReport"));
const AdmittedPatients = lazy(() => import("./pages/AdmittedPatients"));

const PageFallback = () => (
  <div className="min-h-[60vh] flex items-center justify-center">
    <div className="animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent" role="status" aria-label="Loading" />
  </div>
);

// Wrap every route so a loading lazy chunk shows a spinner, never a blank page.
const page = (node: React.ReactNode) => <Suspense fallback={<PageFallback />}>{node}</Suspense>;

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <AuthProvider>
        <SettingsProvider>
          <Toaster />
          <Sonner />
          <AppErrorBoundary>
            <BrowserRouter>
              <PatientProvider>
                <Routes>
                <Route path="/auth" element={page(<Auth />)} />
                <Route path="/" element={
                  <ProtectedRoute>
                    <RoleHome />
                  </ProtectedRoute>
                } />
                <Route path="/reception" element={
                  <ProtectedRoute allowedRoles={['receptionist', 'admin']}>
                    {page(<Reception />)}
                  </ProtectedRoute>
                } />
                <Route path="/nurse" element={
                  <ProtectedRoute allowedRoles={['nurse', 'admin']}>
                    {page(<NurseStation />)}
                  </ProtectedRoute>
                } />
                <Route path="/doctor" element={
                  <ProtectedRoute allowedRoles={['doctor1', 'doctor2', 'admin']}>
                    {page(<Doctor />)}
                  </ProtectedRoute>
                } />
                <Route path="/lab" element={
                  <ProtectedRoute allowedRoles={['lab_tech', 'admin']}>
                    {page(<Laboratory />)}
                  </ProtectedRoute>
                } />
                <Route path="/billing" element={
                  <ProtectedRoute allowedRoles={['billing', 'admin']}>
                    {page(<Billing />)}
                  </ProtectedRoute>
                } />
                <Route path="/billing/pricelist" element={
                  <ProtectedRoute allowedRoles={['billing', 'admin']}>
                    {page(<BillingPricelist />)}
                  </ProtectedRoute>
                } />
                <Route path="/cashier" element={
                  <ProtectedRoute allowedRoles={['receptionist', 'cashier', 'admin']}>
                    {page(<Cashier />)}
                  </ProtectedRoute>
                } />
                <Route path="/pharmacy" element={
                  <ProtectedRoute allowedRoles={['pharmacist', 'admin']}>
                    {page(<Pharmacy />)}
                  </ProtectedRoute>
                } />
                <Route path="/store" element={
                  <ProtectedRoute allowedRoles={['store', 'admin']}>
                    {page(<Store />)}
                  </ProtectedRoute>
                } />
                <Route path="/account" element={
                  <ProtectedRoute allowedRoles={['accountant', 'admin']}>
                    {page(<Account />)}
                  </ProtectedRoute>
                } />
                <Route path="/account/payroll" element={
                  <ProtectedRoute allowedRoles={['accountant', 'admin']}>
                    {page(<AccountPayroll />)}
                  </ProtectedRoute>
                } />
                <Route path="/daily-sales-report" element={
                  <ProtectedRoute allowedRoles={['receptionist', 'cashier', 'accountant', 'admin']}>
                    {page(<DailySalesReportPage />)}
                  </ProtectedRoute>
                } />
                <Route path="/auditing" element={
                  <ProtectedRoute allowedRoles={['admin']}>
                    {page(<Auditing />)}
                  </ProtectedRoute>
                } />
                <Route path="/claims" element={
                  <ProtectedRoute allowedRoles={['claims_manager', 'admin']}>
                    {page(<Claims />)}
                  </ProtectedRoute>
                } />
                <Route path="/emr" element={
                  <ProtectedRoute allowedRoles={['doctor1', 'doctor2', 'nurse', 'lab_tech', 'pharmacist', 'admin']}>
                    {page(<EMR />)}
                  </ProtectedRoute>
                } />
                <Route path="/admitted-patients" element={
                  <ProtectedRoute allowedRoles={['doctor1', 'doctor2', 'nurse', 'admin']}>
                    {page(<AdmittedPatients />)}
                  </ProtectedRoute>
                } />
                <Route path="/admin" element={
                  <ProtectedRoute allowedRoles={['admin']}>
                    {page(<Admin />)}
                  </ProtectedRoute>
                } />
                <Route path="/settings" element={
                  <ProtectedRoute>
                    {page(<Settings />)}
                  </ProtectedRoute>
                } />
                <Route path="/install" element={
                  <ProtectedRoute>
                    {page(<Install />)}
                  </ProtectedRoute>
                } />
                  <Route path="*" element={<NotFound />} />
                </Routes>
              </PatientProvider>
            </BrowserRouter>
          </AppErrorBoundary>
        </SettingsProvider>
      </AuthProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
