import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useState } from 'react';
import { QtyInput } from './QtyInput';

function Harness({ onChange, min, max }: { onChange?: (qty: number) => void; min?: number; max?: number }) {
  const [qty, setQty] = useState(1);
  return (
    <QtyInput
      value={qty}
      min={min}
      max={max}
      onChange={(q) => {
        setQty(q);
        onChange?.(q);
      }}
    />
  );
}

function getQtyField() {
  return screen.getByLabelText('Quantity') as HTMLInputElement;
}

function getButton(label: string) {
  return screen.getByLabelText(label) as HTMLButtonElement;
}

describe('QtyInput', () => {
  it('renders with the current value and steppers', () => {
    render(<QtyInput value={3} onChange={() => {}} />);
    expect(getQtyField().value).toBe('3');
    expect(getButton('Decrease quantity')).toBeEnabled();
    expect(getButton('Increase quantity')).toBeEnabled();
  });

  it('lets the officer type freely without snapping back to 1 while typing', () => {
    const onChange = vi.fn();
    render(<QtyInput value={1} onChange={onChange} />);
    const field = getQtyField();
    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: '' } });
    // Clearing mid-typing must not fire onChange or reset the draft.
    expect(onChange).not.toHaveBeenCalled();
    expect(field.value).toBe('');
    fireEvent.change(field, { target: { value: '1' } });
    fireEvent.change(field, { target: { value: '10' } });
    expect(field.value).toBe('10');
    expect(onChange).toHaveBeenLastCalledWith(10);
  });

  it('commits a clamped value on blur after free typing', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const field = getQtyField();
    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: '' } });
    fireEvent.blur(field);
    expect(onChange).not.toHaveBeenCalled();
    expect(field.value).toBe('1');
  });

  it('commits on Enter and blurs the field', () => {
    render(<Harness />);
    const field = getQtyField();
    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: '5' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(field.value).toBe('5');
    expect(field).not.toHaveFocus();
  });

  it('steps up and down with the buttons and respects min/max', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} max={3} />);
    const plus = getButton('Increase quantity');
    const minus = getButton('Decrease quantity');
    expect(minus).toBeDisabled();
    fireEvent.click(plus);
    expect(onChange).toHaveBeenLastCalledWith(2);
    fireEvent.click(minus);
    expect(onChange).toHaveBeenLastCalledWith(1);
    expect(minus).toBeDisabled();
    fireEvent.click(plus);
    fireEvent.click(plus);
    expect(plus).toBeDisabled();
    expect(onChange).toHaveBeenLastCalledWith(3);
  });

  it('ignores non-numeric input', () => {
    const onChange = vi.fn();
    render(<QtyInput value={1} onChange={onChange} />);
    const field = getQtyField();
    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: 'abc' } });
    expect(field.value).toBe('');
    expect(onChange).not.toHaveBeenCalled();
  });
});
