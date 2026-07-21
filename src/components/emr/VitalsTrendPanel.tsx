import { useEffect, useMemo, useState } from 'react';
import { format, subDays, startOfDay, endOfDay } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  ReferenceArea,
} from 'recharts';

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

// Clinical normal ranges (adult)
const RANGES = {
  temperature: { min: 36.1, max: 37.8, unit: '°C' },
  pulse: { min: 60, max: 100, unit: 'bpm' },
  respiratory_rate: { min: 12, max: 20, unit: '/min' },
  systolic: { min: 90, max: 139, unit: 'mmHg' },
  diastolic: { min: 60, max: 89, unit: 'mmHg' },
};

function isAbnormal(key: keyof typeof RANGES, value: number | null | undefined) {
  if (value == null || isNaN(value as number)) return false;
  const r = RANGES[key];
  return (value as number) < r.min || (value as number) > r.max;
}

function parseBP(bp: string | null): { sys: number | null; dia: number | null } {
  if (!bp) return { sys: null, dia: null };
  const [s, d] = bp.split('/').map((n) => parseInt(n, 10));
  return { sys: isNaN(s) ? null : s, dia: isNaN(d) ? null : d };
}

type Preset = '7d' | '30d' | '90d' | 'all' | 'custom';

export function VitalsTrendPanel({ patientId }: { patientId: string }) {
  const [vitals, setVitals] = useState<Vital[]>([]);
  const [loading, setLoading] = useState(true);
  const [preset, setPreset] = useState<Preset>('30d');
  const [fromDate, setFromDate] = useState<string>(format(subDays(new Date(), 30), 'yyyy-MM-dd'));
  const [toDate, setToDate] = useState<string>(format(new Date(), 'yyyy-MM-dd'));

  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from('vitals')
        .select('*')
        .eq('patient_id', patientId)
        .order('created_at', { ascending: true });
      if (mounted) {
        setVitals((data ?? []) as Vital[]);
        setLoading(false);
      }
    })();

    const channel = supabase
      .channel(`vitals-${patientId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'vitals', filter: `patient_id=eq.${patientId}` },
        async () => {
          const { data } = await supabase
            .from('vitals')
            .select('*')
            .eq('patient_id', patientId)
            .order('created_at', { ascending: true });
          setVitals((data ?? []) as Vital[]);
        }
      )
      .subscribe();

    return () => {
      mounted = false;
      supabase.removeChannel(channel);
    };
  }, [patientId]);

  const applyPreset = (p: Preset) => {
    setPreset(p);
    const now = new Date();
    if (p === '7d') setFromDate(format(subDays(now, 7), 'yyyy-MM-dd'));
    else if (p === '30d') setFromDate(format(subDays(now, 30), 'yyyy-MM-dd'));
    else if (p === '90d') setFromDate(format(subDays(now, 90), 'yyyy-MM-dd'));
    else if (p === 'all') setFromDate('1970-01-01');
    if (p !== 'custom') setToDate(format(now, 'yyyy-MM-dd'));
  };

  const filtered = useMemo(() => {
    const from = startOfDay(new Date(fromDate)).getTime();
    const to = endOfDay(new Date(toDate)).getTime();
    return vitals.filter((v) => {
      const t = new Date(v.created_at).getTime();
      return t >= from && t <= to;
    });
  }, [vitals, fromDate, toDate]);

  const chartData = useMemo(
    () =>
      filtered.map((v) => {
        const { sys, dia } = parseBP(v.blood_pressure);
        return {
          date: format(new Date(v.created_at), 'MM/dd HH:mm'),
          temp: v.temperature,
          pulse: v.pulse,
          rr: v.respiratory_rate,
          weight: v.weight,
          systolic: sys,
          diastolic: dia,
        };
      }),
    [filtered]
  );

  const abnormalCount = useMemo(() => {
    let c = 0;
    for (const v of filtered) {
      const { sys, dia } = parseBP(v.blood_pressure);
      if (isAbnormal('temperature', v.temperature)) c++;
      if (isAbnormal('pulse', v.pulse)) c++;
      if (isAbnormal('respiratory_rate', v.respiratory_rate)) c++;
      if (isAbnormal('systolic', sys)) c++;
      if (isAbnormal('diastolic', dia)) c++;
    }
    return c;
  }, [filtered]);

  if (loading)
    return <p className="text-sm text-muted-foreground text-center py-8">Loading vitals...</p>;

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex gap-1">
            {(['7d', '30d', '90d', 'all'] as Preset[]).map((p) => (
              <Button
                key={p}
                size="sm"
                variant={preset === p ? 'default' : 'outline'}
                onClick={() => applyPreset(p)}
              >
                {p === 'all' ? 'All' : `Last ${p}`}
              </Button>
            ))}
          </div>
          <div className="flex items-end gap-2">
            <div>
              <Label className="text-xs">From</Label>
              <Input
                type="date"
                value={fromDate}
                onChange={(e) => {
                  setFromDate(e.target.value);
                  setPreset('custom');
                }}
                className="h-9 w-[150px]"
              />
            </div>
            <div>
              <Label className="text-xs">To</Label>
              <Input
                type="date"
                value={toDate}
                onChange={(e) => {
                  setToDate(e.target.value);
                  setPreset('custom');
                }}
                className="h-9 w-[150px]"
              />
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Badge variant="outline">{filtered.length} readings</Badge>
            {abnormalCount > 0 && (
              <Badge variant="destructive" className="gap-1">
                <AlertTriangle className="h-3 w-3" />
                {abnormalCount} abnormal
              </Badge>
            )}
          </div>
        </div>
      </Card>

      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">
          No vitals in selected range
        </p>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card className="p-4">
              <h4 className="text-sm font-medium mb-3">Temperature (°C) & Pulse (bpm)</h4>
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="date" fontSize={11} />
                  <YAxis fontSize={11} />
                  <Tooltip />
                  <ReferenceArea
                    y1={RANGES.temperature.min}
                    y2={RANGES.temperature.max}
                    fill="hsl(var(--primary))"
                    fillOpacity={0.06}
                  />
                  <Line
                    type="monotone"
                    dataKey="temp"
                    stroke="hsl(var(--destructive))"
                    strokeWidth={2}
                    name="Temp"
                    dot={(props: any) => {
                      const { cx, cy, payload, index } = props;
                      const bad = isAbnormal('temperature', payload.temp);
                      return (
                        <circle
                          key={`t-${index}`}
                          cx={cx}
                          cy={cy}
                          r={bad ? 5 : 3}
                          fill={bad ? 'hsl(var(--destructive))' : 'hsl(var(--background))'}
                          stroke="hsl(var(--destructive))"
                          strokeWidth={2}
                        />
                      );
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="pulse"
                    stroke="hsl(var(--primary))"
                    strokeWidth={2}
                    name="Pulse"
                    dot={(props: any) => {
                      const { cx, cy, payload, index } = props;
                      const bad = isAbnormal('pulse', payload.pulse);
                      return (
                        <circle
                          key={`p-${index}`}
                          cx={cx}
                          cy={cy}
                          r={bad ? 5 : 3}
                          fill={bad ? 'hsl(var(--destructive))' : 'hsl(var(--background))'}
                          stroke="hsl(var(--primary))"
                          strokeWidth={2}
                        />
                      );
                    }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </Card>

            <Card className="p-4">
              <h4 className="text-sm font-medium mb-3">Blood Pressure (mmHg)</h4>
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="date" fontSize={11} />
                  <YAxis fontSize={11} />
                  <Tooltip />
                  <ReferenceArea
                    y1={RANGES.systolic.min}
                    y2={RANGES.systolic.max}
                    fill="hsl(var(--primary))"
                    fillOpacity={0.06}
                  />
                  <Line
                    type="monotone"
                    dataKey="systolic"
                    stroke="hsl(var(--module-billing))"
                    strokeWidth={2}
                    name="Systolic"
                    dot={(props: any) => {
                      const { cx, cy, payload, index } = props;
                      const bad = isAbnormal('systolic', payload.systolic);
                      return (
                        <circle
                          key={`s-${index}`}
                          cx={cx}
                          cy={cy}
                          r={bad ? 5 : 3}
                          fill={bad ? 'hsl(var(--destructive))' : 'hsl(var(--background))'}
                          stroke="hsl(var(--module-billing))"
                          strokeWidth={2}
                        />
                      );
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="diastolic"
                    stroke="hsl(var(--accent))"
                    strokeWidth={2}
                    name="Diastolic"
                    dot={(props: any) => {
                      const { cx, cy, payload, index } = props;
                      const bad = isAbnormal('diastolic', payload.diastolic);
                      return (
                        <circle
                          key={`d-${index}`}
                          cx={cx}
                          cy={cy}
                          r={bad ? 5 : 3}
                          fill={bad ? 'hsl(var(--destructive))' : 'hsl(var(--background))'}
                          stroke="hsl(var(--accent))"
                          strokeWidth={2}
                        />
                      );
                    }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </Card>
          </div>

          <Card>
            <div className="p-3 border-b border-border flex items-center justify-between">
              <h4 className="text-sm font-medium">Continuous Timeline</h4>
              <span className="text-xs text-muted-foreground">
                Abnormal values highlighted in red
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr className="text-left">
                    <th className="p-3 font-medium">Date &amp; Time</th>
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
                  {[...filtered].reverse().map((v) => {
                    const { sys, dia } = parseBP(v.blood_pressure);
                    const tempBad = isAbnormal('temperature', v.temperature);
                    const pulseBad = isAbnormal('pulse', v.pulse);
                    const rrBad = isAbnormal('respiratory_rate', v.respiratory_rate);
                    const bpBad = isAbnormal('systolic', sys) || isAbnormal('diastolic', dia);
                    const anyBad = tempBad || pulseBad || rrBad || bpBad;
                    return (
                      <tr
                        key={v.id}
                        className={cn(
                          'border-t border-border',
                          anyBad && 'bg-destructive/5'
                        )}
                      >
                        <td className="p-3 whitespace-nowrap">
                          {format(new Date(v.created_at), 'MMM dd, yyyy h:mm a')}
                        </td>
                        <td className={cn('p-3', tempBad && 'text-destructive font-semibold')}>
                          {v.temperature ?? '—'}
                        </td>
                        <td className={cn('p-3', bpBad && 'text-destructive font-semibold')}>
                          {v.blood_pressure ?? '—'}
                        </td>
                        <td className={cn('p-3', pulseBad && 'text-destructive font-semibold')}>
                          {v.pulse ?? '—'}
                        </td>
                        <td className={cn('p-3', rrBad && 'text-destructive font-semibold')}>
                          {v.respiratory_rate ?? '—'}
                        </td>
                        <td className="p-3">{v.weight ?? '—'}</td>
                        <td className="p-3">{v.height ?? '—'}</td>
                        <td className="p-3 text-muted-foreground">{v.notes ?? '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="p-3 border-t border-border text-xs text-muted-foreground flex flex-wrap gap-x-4 gap-y-1">
              <span>Normal ranges:</span>
              <span>Temp {RANGES.temperature.min}–{RANGES.temperature.max}°C</span>
              <span>Pulse {RANGES.pulse.min}–{RANGES.pulse.max} bpm</span>
              <span>RR {RANGES.respiratory_rate.min}–{RANGES.respiratory_rate.max}/min</span>
              <span>BP {RANGES.systolic.min}–{RANGES.systolic.max}/{RANGES.diastolic.min}–{RANGES.diastolic.max}</span>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
