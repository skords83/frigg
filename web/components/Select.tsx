'use client';

import * as RadixSelect from '@radix-ui/react-select';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

function ChevronIcon() {
  return (
    <svg className="w-3.5 h-3.5 text-muted shrink-0 transition-transform duration-150 group-data-[state=open]:rotate-180" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Select({
  value,
  onValueChange,
  options,
  placeholder,
  triggerClassName,
  disabled,
  open,
  onOpenChange,
}: {
  value: string;
  onValueChange: (v: string) => void;
  options: SelectOption[];
  placeholder?: string;
  triggerClassName: string;
  disabled?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  return (
    <RadixSelect.Root value={value} onValueChange={onValueChange} disabled={disabled} open={open} onOpenChange={onOpenChange}>
      <RadixSelect.Trigger className={`group ${triggerClassName}`}>
        <RadixSelect.Value placeholder={placeholder} />
        <RadixSelect.Icon>
          <ChevronIcon />
        </RadixSelect.Icon>
      </RadixSelect.Trigger>
      <RadixSelect.Portal>
        <RadixSelect.Content
          position="popper"
          sideOffset={4}
          className="popover-in z-[60] bg-surface border border-divider rounded-lg shadow-lg overflow-hidden"
        >
          <RadixSelect.Viewport className="p-1 max-h-64">
            {options.map((o) => (
              <RadixSelect.Item
                key={o.value}
                value={o.value}
                disabled={o.disabled}
                className="relative flex items-center px-3 py-1.5 text-[13px] text-muted rounded-md cursor-pointer select-none outline-none transition-colors data-[highlighted]:bg-surface-raised data-[highlighted]:text-foreground data-[state=checked]:bg-surface-raised data-[state=checked]:text-foreground data-[state=checked]:shadow-[inset_2px_0_0_var(--accent)] data-[disabled]:opacity-40 data-[disabled]:cursor-not-allowed"
              >
                <RadixSelect.ItemText>{o.label}</RadixSelect.ItemText>
              </RadixSelect.Item>
            ))}
          </RadixSelect.Viewport>
        </RadixSelect.Content>
      </RadixSelect.Portal>
    </RadixSelect.Root>
  );
}
