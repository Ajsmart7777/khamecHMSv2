import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import { Staff, UserRole } from '@/types/hms';

interface DbStaff {
  id: string;
  employee_id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  role: string;
  department: string;
  salary: number;
  hire_date: string;
  status: string;
  deleted_at?: string | null;
  deleted_by?: string | null;
  deletion_reason?: string | null;
  bank_name?: string | null;
  account_number?: string | null;
  payment_method?: string;
  designation?: string | null;
  staff_id_number?: string | null;
  is_system_user?: boolean;
  family_deduction_consent?: boolean;
  auth_user_id?: string | null;
}

const mapDbToStaff = (db: DbStaff): Staff => ({
  id: db.id,
  employeeId: db.employee_id,
  firstName: db.first_name,
  lastName: db.last_name,
  email: db.email,
  phone: db.phone,
  role: db.role as UserRole,
  department: db.department,
  salary: Number(db.salary),
  hireDate: db.hire_date,
  status: db.status as 'active' | 'inactive' | 'on_leave' | 'deleted',
  bankName: db.bank_name || null,
  accountNumber: db.account_number || null,
  paymentMethod: db.payment_method || 'cash',
  designation: db.designation || null,
  staffIdNumber: db.staff_id_number || null,
  isSystemUser: !!db.is_system_user,
  familyDeductionConsent: !!db.family_deduction_consent,
  authUserId: db.auth_user_id || null,
});

const mapStaffToDb = (staff: Omit<Staff, 'id'>) => ({
  employee_id: staff.employeeId,
  first_name: staff.firstName,
  last_name: staff.lastName,
  email: staff.email,
  phone: staff.phone,
  role: staff.role,
  department: staff.department,
  salary: staff.salary,
  hire_date: staff.hireDate,
  status: staff.status,
  bank_name: staff.bankName ?? null,
  account_number: staff.accountNumber ?? null,
  payment_method: staff.paymentMethod ?? 'cash',
  designation: staff.designation ?? null,
  staff_id_number: staff.staffIdNumber ?? null,
  is_system_user: !!staff.isSystemUser,
  family_deduction_consent: !!staff.familyDeductionConsent,
  auth_user_id: staff.authUserId ?? null,
});

export function useStaff() {
  const [staff, setStaff] = useState<Staff[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStaff = async () => {
    setLoading(true);
    setError(null);
    
    const { data, error: fetchError } = await supabase
      .from('staff')
      .select('*')
      .order('created_at', { ascending: false });

    if (fetchError) {
      console.error('Error fetching staff:', fetchError);
      setError(fetchError.message);
      setStaff([]);
    } else {
      setStaff((data as DbStaff[]).map(mapDbToStaff));
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchStaff();
  }, []);

  const addStaff = async (newStaff: Omit<Staff, 'id'>): Promise<boolean> => {
    const { data, error: insertError } = await supabase
      .from('staff')
      .insert(mapStaffToDb(newStaff))
      .select()
      .single();

    if (insertError) {
      console.error('Error adding staff:', insertError);
      toast({ 
        title: "Error", 
        description: insertError.message, 
        variant: "destructive" 
      });
      return false;
    }

    setStaff(prev => [mapDbToStaff(data as DbStaff), ...prev]);
    toast({ title: "Success", description: "Staff member added successfully." });
    return true;
  };

  const updateStaff = async (id: string, updates: Partial<Staff>): Promise<boolean> => {
    const dbUpdates: Record<string, unknown> = {};
    if (updates.employeeId !== undefined) dbUpdates.employee_id = updates.employeeId;
    if (updates.firstName !== undefined) dbUpdates.first_name = updates.firstName;
    if (updates.lastName !== undefined) dbUpdates.last_name = updates.lastName;
    if (updates.email !== undefined) dbUpdates.email = updates.email;
    if (updates.phone !== undefined) dbUpdates.phone = updates.phone;
    if (updates.role !== undefined) dbUpdates.role = updates.role;
    if (updates.department !== undefined) dbUpdates.department = updates.department;
    if (updates.salary !== undefined) dbUpdates.salary = updates.salary;
    if (updates.hireDate !== undefined) dbUpdates.hire_date = updates.hireDate;
    if (updates.status !== undefined) dbUpdates.status = updates.status;

    const { error: updateError } = await supabase
      .from('staff')
      .update(dbUpdates)
      .eq('id', id);

    if (updateError) {
      console.error('Error updating staff:', updateError);
      toast({ 
        title: "Error", 
        description: updateError.message, 
        variant: "destructive" 
      });
      return false;
    }

    setStaff(prev => prev.map(s => s.id === id ? { ...s, ...updates } : s));
    toast({ title: "Success", description: "Staff record updated successfully." });
    return true;
  };

  const deleteStaff = async (id: string): Promise<boolean> => {
    const target = staff.find((member) => member.id === id);
    if (!target || target.status === 'deleted') return false;
    const confirmed = window.confirm(`Deactivate ${target.firstName} ${target.lastName}? Linked Staff and Staff Family patients will be preserved and placed in Reception migration queue.`);
    if (!confirmed) return false;

    const { data, error: deleteError } = await supabase.rpc('deactivate_staff_for_migration', {
      _staff_id: id,
      _reason: 'Staff account deactivated by administrator',
    });

    if (deleteError) {
      console.error('Error deactivating staff:', deleteError);
      toast({
        title: "Error",
        description: deleteError.message,
        variant: "destructive",
      });
      return false;
    }

    const result = (data && typeof data === 'object' && 'data' in data ? (data as { data: Record<string, unknown> }).data : data) as Record<string, unknown> | null;
    const staffPatients = Number(result?.staff_patient_count ?? 0);
    const familyPatients = Number(result?.family_patient_count ?? 0);
    setStaff(prev => prev.map(s => s.id === id ? { ...s, status: 'deleted' } : s));
    toast({
      title: "Staff deactivated safely",
      description: `${staffPatients + familyPatients} linked patient record(s) now require Reception migration. Historical data was preserved.`,
    });
    window.dispatchEvent(new CustomEvent('staff-data-changed'));
    return true;
  };

  const importStaff = async (staffList: Omit<Staff, 'id'>[]): Promise<number> => {
    const dbRecords = staffList.map(mapStaffToDb);
    
    const { data, error: insertError } = await supabase
      .from('staff')
      .insert(dbRecords)
      .select();

    if (insertError) {
      console.error('Error importing staff:', insertError);
      toast({ 
        title: "Import Error", 
        description: insertError.message, 
        variant: "destructive" 
      });
      return 0;
    }

    const imported = (data as DbStaff[]).map(mapDbToStaff);
    setStaff(prev => [...imported, ...prev]);
    return imported.length;
  };

  return {
    staff,
    loading,
    error,
    addStaff,
    updateStaff,
    deleteStaff,
    importStaff,
    refetch: fetchStaff,
  };
}
