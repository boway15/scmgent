import { useEffect, useId, useState } from 'react';
import { Input } from '@/components/ui/input';

type BomCategoryFieldProps = {
  value?: string;
  defaultValue?: string;
  options: readonly string[];
  onChange?: (value: string) => void;
  onBlur?: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
};

export function BomCategoryField({
  value,
  defaultValue,
  options,
  onChange,
  onBlur,
  disabled = false,
  placeholder = '选择或输入大类',
  className,
}: BomCategoryFieldProps) {
  const listId = useId();
  const isControlled = value !== undefined;
  const [internalValue, setInternalValue] = useState(defaultValue ?? value ?? '');

  useEffect(() => {
    if (!isControlled && defaultValue !== undefined) {
      setInternalValue(defaultValue);
    }
  }, [defaultValue, isControlled]);

  const displayed = isControlled ? value : internalValue;

  return (
    <>
      <Input
        className={className}
        list={listId}
        value={displayed}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(event) => {
          const next = event.target.value;
          if (!isControlled) setInternalValue(next);
          onChange?.(next);
        }}
        onBlur={(event) => onBlur?.(event.target.value)}
      />
      <datalist id={listId}>
        {options.map((option) => (
          <option key={option} value={option} />
        ))}
      </datalist>
    </>
  );
}

type BomUnitFieldProps = {
  value: string;
  category: string;
  unitHints: readonly string[];
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
};

export function BomUnitField({
  value,
  category,
  unitHints,
  onChange,
  disabled = false,
  className,
}: BomUnitFieldProps) {
  const listId = useId();

  return (
    <>
      <Input
        className={className}
        list={listId}
        value={value}
        placeholder={category === '板材' ? '单位（如 张）' : '单位'}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
      <datalist id={listId}>
        {unitHints.map((option) => (
          <option key={option} value={option} />
        ))}
      </datalist>
    </>
  );
}
