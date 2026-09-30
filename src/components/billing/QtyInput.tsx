import { useEffect, useRef, useState } from 'react';
import { Minus, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

interface QtyInputProps {
  /** Current committed quantity (always >= min). */
  value: number;
  /** Called with the new committed quantity whenever it validly changes. */
  onChange: (qty: number) => void;
  min?: number;
  max?: number;
  disabled?: boolean;
  className?: string;
}

/**
 * Quantity stepper for billing lines.
 *
 * A plain type="number" input is hostile for billing officers: clearing the
 * field (or typing "1" then "0") parses to NaN and the old `|| 1` fallback
 * snaps the value back to 1 mid-typing. This component keeps the raw text in
 * local state so the officer can type freely, and only pushes a clamped value
 * up when the field is left or the stepper buttons are used.
 */
export function QtyInput({ value, onChange, min = 1, max = 9999, disabled, className }: QtyInputProps) {
  const clamp = (n: number) => Math.min(Math.max(Math.trunc(n) || min, min), max);
  const [draft, setDraft] = useState(String(value));
  const focusedRef = useRef(false);

  // Follow external resets (e.g. row added/removed) only while not editing.
  useEffect(() => {
    if (!focusedRef.current) setDraft(String(value));
  }, [value]);

  const commit = (raw: string) => {
    const next = clamp(Number(raw));
    setDraft(String(next));
    if (next !== value) onChange(next);
  };

  const step = (delta: number) => {
    const next = clamp(value + delta);
    setDraft(String(next));
    onChange(next);
  };

  return (
    <div className={cn('inline-flex items-center', className)}>
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="h-8 w-8 rounded-r-none border-r-0"
        disabled={disabled || value <= min}
        aria-label="Decrease quantity"
        onClick={() => step(-1)}
      >
        <Minus className="h-3 w-3" />
      </Button>
      <Input
        type="text"
        inputMode="numeric"
        className="h-8 w-14 rounded-none text-center text-sm px-1"
        value={draft}
        disabled={disabled}
        aria-label="Quantity"
        onFocus={() => { focusedRef.current = true; }}
        onChange={(e) => {
          const raw = e.target.value.replace(/[^0-9]/g, '');
          setDraft(raw);
          // Live-commit valid numbers so totals update as the officer types.
          if (raw !== '') {
            const n = Number(raw);
            if (Number.isFinite(n) && n >= min && n <= max) onChange(clamp(n));
          }
        }}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit(draft);
            (e.target as HTMLInputElement).blur();
          }
        }}
      />
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="h-8 w-8 rounded-l-none border-l-0"
        disabled={disabled || value >= max}
        aria-label="Increase quantity"
        onClick={() => step(1)}
      >
        <Plus className="h-3 w-3" />
      </Button>
    </div>
  );
}
