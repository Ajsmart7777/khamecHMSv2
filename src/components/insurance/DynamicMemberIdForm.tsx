import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { ProviderField } from '@/lib/providerFields';

interface Props {
  fields: ProviderField[];
  values: Record<string, string>;
  errors?: Record<string, string>;
  onChange: (values: Record<string, string>) => void;
  disabled?: boolean;
}

export function DynamicMemberIdForm({ fields, values, errors, onChange, disabled }: Props) {
  const set = (key: string, v: string) => onChange({ ...values, [key]: v });

  return (
    <div className="grid grid-cols-2 gap-3">
      {fields.map((f) => (
        <div key={f.key} className="space-y-1 col-span-2 sm:col-span-1">
          <Label className="text-xs">
            {f.label}
            {f.required && <span className="text-destructive ml-0.5">*</span>}
            {f.primary && <span className="text-[10px] text-primary ml-1">(primary)</span>}
          </Label>
          <Input
            value={values[f.key] ?? ''}
            onChange={(e) => set(f.key, e.target.value)}
            placeholder={f.placeholder || ''}
            disabled={disabled}
            className={errors?.[f.key] ? 'border-destructive' : ''}
          />
          {f.helper && !errors?.[f.key] && (
            <p className="text-[10px] text-muted-foreground">{f.helper}</p>
          )}
          {errors?.[f.key] && (
            <p className="text-[10px] text-destructive">{errors[f.key]}</p>
          )}
        </div>
      ))}
    </div>
  );
}