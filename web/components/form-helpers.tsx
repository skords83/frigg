export const inputCls =
  'bg-transparent border border-divider rounded-md px-2.5 py-1.5 text-[13px] text-foreground placeholder:text-muted focus:outline-none focus:border-accent-dim transition-colors';

export function FormSection({ label, children }: { label: string; children: React.ReactNode }) {
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
  const allOptions = options.includes(value) ? options : [value, ...options];
  return (
    <select
      className="bg-transparent border border-divider rounded-md px-2 py-1.5 text-[11px] font-mono text-muted focus:outline-none focus:border-accent-dim transition-colors w-[90px] shrink-0"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {allOptions.map((o) => (
        <option key={o} value={o}>{o}</option>
      ))}
    </select>
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
          className="font-mono text-[11px] tracking-wider px-4 py-1.5 rounded-full border border-divider text-muted hover:border-accent-dim hover:text-accent transition-colors"
        >
          Abbrechen
        </button>
        <button
          onClick={onSave}
          disabled={saving}
          className="font-mono text-[11px] tracking-wider px-4 py-1.5 rounded-full bg-accent text-surface border border-accent hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          {saving ? `${saveLabel} …` : saveLabel}
        </button>
      </div>
    </div>
  );
}
