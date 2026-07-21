import { StatsCard } from '@/components/dashboard/StatsCard';
import { Users, DollarSign, Wallet, Clock } from 'lucide-react';
import { PayrollPeriod, PayrollEntry } from '@/hooks/usePayroll';
import { Staff } from '@/types/hms';

interface Props {
  staff: Staff[];
  periods: PayrollPeriod[];
  latestEntries: PayrollEntry[];
}

const MONTHS = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function PayrollDashboard({ staff, periods, latestEntries }: Props) {
  const totalStaff = staff.length;
  const totalSalary = staff.reduce((s, st) => s + st.salary, 0);
  const totalGross = latestEntries.reduce((s, e) => s + e.gross_pay, 0);
  const pendingPayments = latestEntries.filter(e => e.status === 'pending').length;
  const latestPeriod = periods[0];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsCard title="Total Staff" value={totalStaff} icon={Users} color="text-primary" subtitle="Active employees" />
        <StatsCard title="Monthly Payroll" value={`₦${(totalSalary / 1000).toFixed(0)}K`} icon={DollarSign} color="text-success" />
        <StatsCard title="Last Gross Pay" value={`₦${(totalGross / 1000).toFixed(0)}K`} icon={Wallet} color="text-info" />
        <StatsCard title="Pending Payments" value={pendingPayments} icon={Clock} color="text-warning" />
      </div>

      {latestPeriod && (
        <div className="bg-card border border-border rounded-xl p-4">
          <h3 className="font-semibold mb-3">Latest Payroll Period</h3>
          <div className="flex items-center gap-4 text-sm">
            <span className="font-medium">{MONTHS[latestPeriod.month]} {latestPeriod.year}</span>
            <span className={`px-2 py-0.5 rounded text-xs font-medium ${
              latestPeriod.status === 'paid' ? 'bg-green-100 text-green-800' :
              latestPeriod.status === 'locked' ? 'bg-yellow-100 text-yellow-800' :
              'bg-muted text-muted-foreground'
            }`}>{latestPeriod.status.toUpperCase()}</span>
            <span className="text-muted-foreground">{latestEntries.length} entries</span>
          </div>
        </div>
      )}

      {latestEntries.length > 0 && (
        <div className="bg-card border border-border rounded-xl p-4">
          <h3 className="font-semibold mb-3">Recent Payroll Entries</h3>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {latestEntries.slice(0, 10).map(entry => (
              <div key={entry.id} className="flex items-center justify-between p-2 border border-border rounded-lg text-sm">
                <div>
                  <p className="font-medium">{entry.staff_name || 'Unknown'}</p>
                  <p className="text-xs text-muted-foreground">{entry.staff_designation || entry.staff_employee_id}</p>
                </div>
                <div className="text-right">
                  <p className="font-semibold">₦{entry.net_pay.toLocaleString()}</p>
                  <span className={`text-xs px-1.5 py-0.5 rounded ${
                    entry.status === 'paid' ? 'bg-green-100 text-green-800' :
                    entry.status === 'processing' ? 'bg-blue-100 text-blue-800' :
                    'bg-muted text-muted-foreground'
                  }`}>{entry.status}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
