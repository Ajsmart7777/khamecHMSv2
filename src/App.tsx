import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { PatientProvider } from "@/contexts/PatientContext";
import { AuthProvider } from "@/contexts/AuthContext";
import { SettingsProvider } from "@/contexts/SettingsContext";

import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { RoleHome } from "@/components/auth/RoleHome";
import Index from "./pages/Index";
import Auth from "./pages/Auth";
import Reception from "./pages/Reception";
import NurseStation from "./pages/NurseStation";
import Doctor from "./pages/Doctor";
import Laboratory from "./pages/Laboratory";
import Billing from "./pages/Billing";
import Cashier from "./pages/Cashier";
import Pharmacy from "./pages/Pharmacy";

import Account from "./pages/Account";
import Auditing from "./pages/Auditing";
import Admin from "./pages/Admin";
import Settings from "./pages/Settings";
import Install from "./pages/Install";
import NotFound from "./pages/NotFound";
import Claims from "./pages/Claims";
import EMR from "./pages/EMR";
import DailySalesReportPage from "./pages/DailySalesReport";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <AuthProvider>
        <SettingsProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter>
            <PatientProvider>
              <Routes>
                <Route path="/auth" element={<Auth />} />
                <Route path="/" element={
                  <ProtectedRoute>
                    <RoleHome />
                  </ProtectedRoute>
                } />
                <Route path="/reception" element={
                  <ProtectedRoute allowedRoles={['receptionist', 'admin']}>
                    <Reception />
                  </ProtectedRoute>
                } />
                <Route path="/nurse" element={
                  <ProtectedRoute allowedRoles={['nurse', 'admin']}>
                    <NurseStation />
                  </ProtectedRoute>
                } />
                <Route path="/doctor" element={
                  <ProtectedRoute allowedRoles={['doctor1', 'doctor2', 'admin']}>
                    <Doctor />
                  </ProtectedRoute>
                } />
                <Route path="/lab" element={
                  <ProtectedRoute allowedRoles={['lab_tech', 'admin']}>
                    <Laboratory />
                  </ProtectedRoute>
                } />
                <Route path="/billing" element={
                  <ProtectedRoute allowedRoles={['billing', 'admin']}>
                    <Billing />
                  </ProtectedRoute>
                } />
                <Route path="/cashier" element={
                  <ProtectedRoute allowedRoles={['cashier', 'admin']}>
                    <Cashier />
                  </ProtectedRoute>
                } />
                <Route path="/pharmacy" element={
                  <ProtectedRoute allowedRoles={['pharmacist', 'admin']}>
                    <Pharmacy />
                  </ProtectedRoute>
                } />
                <Route path="/account" element={
                  <ProtectedRoute allowedRoles={['accountant', 'admin']}>
                    <Account />
                  </ProtectedRoute>
                } />
                <Route path="/daily-sales-report" element={
                  <ProtectedRoute allowedRoles={['accountant', 'admin']}>
                    <DailySalesReportPage />
                  </ProtectedRoute>
                } />
                <Route path="/auditing" element={
                  <ProtectedRoute allowedRoles={['admin']}>
                    <Auditing />
                  </ProtectedRoute>
                } />
                <Route path="/claims" element={
                  <ProtectedRoute allowedRoles={['claims_manager', 'admin']}>
                    <Claims />
                  </ProtectedRoute>
                } />
                <Route path="/emr" element={
                  <ProtectedRoute allowedRoles={['doctor1', 'doctor2', 'nurse', 'lab_tech', 'pharmacist', 'admin']}>
                    <EMR />
                  </ProtectedRoute>
                } />
                <Route path="/admin" element={
                  <ProtectedRoute allowedRoles={['admin']}>
                    <Admin />
                  </ProtectedRoute>
                } />
                <Route path="/settings" element={
                  <ProtectedRoute>
                    <Settings />
                  </ProtectedRoute>
                } />
                <Route path="/install" element={
                  <ProtectedRoute>
                    <Install />
                  </ProtectedRoute>
                } />
                <Route path="*" element={<NotFound />} />
              </Routes>
            </PatientProvider>
          </BrowserRouter>
        </SettingsProvider>
      </AuthProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
