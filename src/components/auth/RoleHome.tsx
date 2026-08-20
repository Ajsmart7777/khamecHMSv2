import { Navigate } from 'react-router-dom';
import { useAuth, AppRole } from '@/contexts/AuthContext';
import Index from '@/pages/Index';

const roleHomePath: Record<Exclude<AppRole, 'admin'>, string> = {
  receptionist: '/reception',
  nurse: '/nurse',
  doctor1: '/doctor?as=doctor1',
  doctor2: '/doctor?as=doctor2',
  lab_tech: '/lab',
  billing: '/billing',
  cashier: '/reception',
  pharmacist: '/pharmacy',
  store: '/store',
  accountant: '/account',
  claims_manager: '/claims',
};

export function RoleHome() {
  const { role } = useAuth();

  if (role === 'admin') return <Index />;
  if (role && roleHomePath[role]) {
    return <Navigate to={roleHomePath[role]} replace />;
  }
  return <Navigate to="/settings" replace />;
}
