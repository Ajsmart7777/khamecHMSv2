import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';

interface Vital {
  id: string;
  created_at: string;
  temperature: number | null;
  blood_pressure: string | null;
  pulse: number | null;
  respiratory_rate: number | null;
  weight: number | null;
  height: number | null;
  notes: string | null;
}

export function VitalsTrendPanel({ patientId }: { patientId: string }) {
  const [vitals, setVitals] = useState<Vital[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from('vitals')
        .select('*')
        .eq('patient_id', patientId)
        .order('created_at', { ascending: true });
      setVitals((data ?? []) as Vital[]);
      setLoading(false);
    })();
  }, [patientId]);

  if (loading) return <p className="text-sm text-muted-foreground text-center py-8">Loading vitals...</p>;
  if (vitals.length === 0)
    return <p className="text-sm text-muted-foreground text-center py-8">No vitals recorded yet</p>;

  const chartData = vitals.map((v) => {
    const [sys] = (v.blood_pressure || '').split('/').map((n) => parseInt(n, 10));
    return {
      date: format(new Date(v.created_at), 'MM/dd'),
      temp: v.temperature,
      pulse: v.pulse,
      weight: v.weight,
      systolic: isNaN(sys) ? null : sys,
    };
  });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="p-4">
          <h4 className="text-sm font-medium mb-3">Temperature (°C) & Pulse (bpm)</h4>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis dataKey="date" fontSize={11} />
              <YAxis fontSize={11} />
              <Tooltip />
              <Line type="monotone" dataKey="temp" stroke="hsl(var(--destructive))" strokeWidth={2} dot={false} name="Temp" />
              <Line type="monotone" dataKey="pulse" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} name="Pulse" />
            </LineChart>
          </ResponsiveContainer>
        </Card>
        <Card className="p-4">
          <h4 className="text-sm font-medium mb-3">Weight (kg) & Systolic BP</h4>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis dataKey="date" fontSize={11} />
              <YAxis fontSize={11} />
              <Tooltip />
              <Line type="monotone" dataKey="weight" stroke="hsl(var(--accent))" strokeWidth={2} dot={false} name="Weight" />
              <Line type="monotone" dataKey="systolic" stroke="hsl(var(--module-billing))" strokeWidth={2} dot={false} name="Systolic" />
            </LineChart>
          </ResponsiveContainer>
        </Card>
      </div>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr className="text-left">
                <th className="p-3 font-medium">Date</th>
                <th className="p-3 font-medium">Temp</th>
                <th className="p-3 font-medium">BP</th>
                <th className="p-3 font-medium">Pulse</th>
                <th className="p-3 font-medium">RR</th>
                <th className="p-3 font-medium">Weight</th>
                <th className="p-3 font-medium">Height</th>
                <th className="p-3 font-medium">Notes</th>
              </tr>
            </thead>
            <tbody>
              {[...vitals].reverse().map((v) => (
                <tr key={v.id} className="border-t border-border">
                  <td className="p-3 whitespace-nowrap">{format(new Date(v.created_at), 'MMM dd, yyyy h:mm a')}</td>
                  <td className="p-3">{v.temperature ?? '—'}</td>
                  <td className="p-3">{v.blood_pressure ?? '—'}</td>
                  <td className="p-3">{v.pulse ?? '—'}</td>
                  <td className="p-3">{v.respiratory_rate ?? '—'}</td>
                  <td className="p-3">{v.weight ?? '—'}</td>
                  <td className="p-3">{v.height ?? '—'}</td>
                  <td className="p-3 text-muted-foreground">{v.notes ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
