import { Plus, Trash2, GripVertical } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import type { ProviderField } from '@/lib/providerFields';

interface Props {
  value: ProviderField[];
  onChange: (fields: ProviderField[]) => void;
}

const EMPTY: ProviderField = { key: '', label: '', required: false, primary: false };

export function MemberIdFieldsEditor({ value, onChange }: Props) {
  const update = (i: number, patch: Partial<ProviderField>) => {
    const next = value.map((f, idx) => (idx === i ? { ...f, ...patch } : f));
    // If setting primary=true, unset it on other rows.
    if (patch.primary) {
      for (let j = 0; j < next.length; j++) if (j !== i) next[j] = { ...next[j], primary: false };
    }
    onChange(next);
  };
  const remove = (i: number) => onChange(value.filter((_, idx) => idx !== i));
  const add = () => onChange([...value, { ...EMPTY }]);
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= value.length) return;
    const next = value.slice();
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };

  const autoKey = (label: string) =>
    label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <Label className="text-sm font-medium">Member ID form fields</Label>
          <p className="text-[11px] text-muted-foreground">
            These fields will appear when Reception picks this provider during registration
            and when Claims Manager verifies eligibility.
          </p>
        </div>
        <Button type="button" size="sm" variant="outline" onClick={add}>
          <Plus className="h-4 w-4 mr-1" /> Add field
        </Button>
      </div>

      {value.length === 0 && (
        <div className="text-xs text-muted-foreground italic p-3 border border-dashed rounded-md">
          No custom fields yet — a default "Member/Enrollee ID" will be shown.
        </div>
      )}

      <div className="space-y-2">
        {value.map((f, i) => (
          <div key={i} className="p-3 border rounded-md bg-muted/30 space-y-2">
            <div className="flex items-start gap-2">
              <div className="flex flex-col gap-0.5 pt-1">
                <button type="button" onClick={() => move(i, -1)} className="text-muted-foreground hover:text-foreground text-xs" disabled={i === 0}>▲</button>
                <button type="button" onClick={() => move(i, 1)} className="text-muted-foreground hover:text-foreground text-xs" disabled={i === value.length - 1}>▼</button>
              </div>
              <div className="grid grid-cols-2 gap-2 flex-1">
                <div className="space-y-1">
                  <Label className="text-[11px]">Label *</Label>
                  <Input
                    value={f.label}
                    onChange={(e) => {
                      const label = e.target.value;
                      update(i, { label, key: f.key || autoKey(label) });
                    }}
                    placeholder="e.g. Call-up Number"
                    className="h-8"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px]">Key (machine)</Label>
                  <Input
                    value={f.key}
                    onChange={(e) => update(i, { key: autoKey(e.target.value) })}
                    placeholder="auto"
                    className="h-8 font-mono text-xs"
                  />
                </div>
                <div className="space-y-1 col-span-2">
                  <Label className="text-[11px]">Placeholder (optional)</Label>
                  <Input
                    value={f.placeholder || ''}
                    onChange={(e) => update(i, { placeholder: e.target.value })}
                    placeholder="e.g. LA/23A/1234"
                    className="h-8"
                  />
                </div>
              </div>
              <Button type="button" size="icon" variant="ghost" onClick={() => remove(i)} className="h-8 w-8 text-destructive">
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
            <div className="flex items-center gap-4 pl-8 text-xs">
              <label className="flex items-center gap-1.5 cursor-pointer">
                <Checkbox checked={!!f.required} onCheckedChange={(v) => update(i, { required: !!v })} />
                Required
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <Checkbox checked={!!f.primary} onCheckedChange={(v) => update(i, { primary: !!v })} />
                Primary (used as Enrollee ID)
              </label>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}