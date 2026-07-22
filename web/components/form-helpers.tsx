import { forwardRef, useState, useRef, type ReactNode } from 'react';
import { Select } from './Select';

/** Shared enter/exit timing for the four modals — waits out the CSS exit animation before unmounting. */
export function useModalClose(onClose: () => void, duration = 130) {
  const [closing, setClosing] = useState(false);

  function requestClose(after: () => void = onClose) {
    setClosing(true);
    setTimeout(after, duration);
  }

  return { closing, requestClose };
}

export function birthdayToDisplay(iso: string): string {
  // YYYY-MM-DD
  let m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return `${m[3]}.${m[2]}.${m[1]}`;
  // YYYYMMDD (Apple compact format, legacy data)
  m = iso.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return `${m[3]}.${m[2]}.${m[1]}`;
  return iso;
}

export function birthdayToIso(display: string): string {
  const m = display.trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (!m) return display;
  return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

export function normalizePhone(v: string): string {
  const s = v.trim();
  if (!s) return s;
  if (s.startsWith('00')) return '+' + s.slice(2);
  if (s.startsWith('0')) return '+49' + s.slice(1);
  return s;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(v: string): boolean {
  return EMAIL_RE.test(v.trim());
}

const PHONE_RE = /^[0-9+\s()-]+$/;

export function isValidPhone(v: string): boolean {
  return PHONE_RE.test(v.trim());
}

export const ActionButton = forwardRef<
  HTMLButtonElement,
  {
    label: string;
    onClick?: () => void;
    variant?: 'primary' | 'danger' | 'default';
    type?: 'button' | 'submit';
    disabled?: boolean;
  }
>(function ActionButton({ label, onClick, variant = 'default', type = 'button', disabled = false }, ref) {
  const styles: Record<string, string> = {
    primary: 'border-accent-dim text-accent bg-[rgba(201,164,76,0.08)] hover:bg-[rgba(201,164,76,0.15)] hover:border-accent',
    danger: 'border-divider text-muted hover:border-red-500/50 hover:text-red-400',
    default: 'border-divider text-muted hover:border-accent-dim hover:text-accent',
  };
  return (
    <button
      ref={ref}
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`press font-mono text-[11px] tracking-wider px-4 py-1.5 rounded-full border transition-colors disabled:opacity-50 ${styles[variant]}`}
    >
      {label}
    </button>
  );
});

export const inputCls =
  'bg-transparent border border-divider rounded-md px-2.5 py-1.5 text-[13px] text-foreground placeholder:text-muted focus:outline-none focus:border-accent-dim transition-colors';

export function FormSection({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <h3 className="font-mono text-[10px] tracking-widest uppercase text-accent-dim mb-2.5 pb-1.5 border-b border-divider-soft">
        {label}
      </h3>
      {children}
    </div>
  );
}

export function FormField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <input
      className={inputCls + ' w-full'}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={label}
    />
  );
}

export function LabelSelect({ value, options, onChange }: { value: string; options: string[]; onChange: (v: string) => void }) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const isCustom = !options.includes(value);
  const allOptions = isCustom ? [value, ...options] : options;

  function confirmEdit() {
    const v = draft.trim();
    if (v) onChange(v);
    setIsEditing(false);
  }

  if (isEditing) {
    return (
      <input
        ref={inputRef}
        autoFocus
        className="bg-transparent border border-accent-dim rounded-md px-2 py-1.5 text-[11px] font-mono text-foreground focus:outline-none w-[90px] shrink-0"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={confirmEdit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); confirmEdit(); }
          if (e.key === 'Escape') { setIsEditing(false); }
        }}
        placeholder="Label …"
      />
    );
  }

  return (
    <Select
      value={value}
      onValueChange={(v) => {
        if (v === '__custom__') {
          setDraft(isCustom ? value : '');
          setIsEditing(true);
        } else {
          onChange(v);
        }
      }}
      options={[
        ...allOptions.map((o) => ({ value: o, label: o })),
        { value: '__custom__', label: 'Eigenes …' },
      ]}
      triggerClassName="bg-transparent border border-divider rounded-md px-2 py-1.5 text-[11px] font-mono text-muted focus:outline-none focus:border-accent-dim transition-colors w-[90px] shrink-0 flex items-center justify-between gap-1 cursor-pointer"
    />
  );
}

export function RemoveButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="text-muted hover:text-red-400 transition-colors w-6 h-6 flex items-center justify-center shrink-0 text-[16px]"
      title="Entfernen"
    >
      −
    </button>
  );
}

export function AddButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="font-mono text-[11px] tracking-wider text-muted hover:text-accent transition-colors flex items-center gap-1"
    >
      <span className="text-[16px] leading-none">+</span> Hinzufügen
    </button>
  );
}

export function ModalFooter({
  error,
  saving,
  onClose,
  onSave,
  saveLabel = 'Speichern',
}: {
  error: string | null;
  saving: boolean;
  onClose: () => void;
  onSave: () => void;
  saveLabel?: string;
}) {
  return (
    <div className="shrink-0 px-6 py-4 border-t border-divider flex flex-col gap-2">
      {error && <p className="text-[12px] text-red-500 font-mono">{error}</p>}
      <div className="flex justify-end gap-3">
        <button
          onClick={onClose}
          className="press font-mono text-[11px] tracking-wider px-4 py-1.5 rounded-full border border-divider text-muted hover:border-accent-dim hover:text-accent transition-colors"
        >
          Abbrechen
        </button>
        <button
          onClick={onSave}
          disabled={saving}
          className="press font-mono text-[11px] tracking-wider px-4 py-1.5 rounded-full bg-accent text-surface border border-accent hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          {saving ? `${saveLabel} …` : saveLabel}
        </button>
      </div>
    </div>
  );
}
