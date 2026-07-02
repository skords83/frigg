'use client';

import { useState } from 'react';
import type { SmartGroup, GroupRule, GroupRuleField, GroupRuleOperator } from '@/types/contact';
import { useModalClose } from './form-helpers';

interface GroupEditorModalProps {
  initial?: SmartGroup;
  onSave: (group: SmartGroup) => void;
  onClose: () => void;
}

const FIELD_LABELS: Record<GroupRuleField, string> = {
  family_name: 'Nachname',
  given_name: 'Vorname',
  fn: 'Vollständiger Name',
  org: 'Firma',
  title: 'Titel',
  note: 'Notiz',
  birthday: 'Geburtstag',
  emails: 'E-Mail',
  phones: 'Telefon',
  'addresses.city': 'Stadt',
  'addresses.country': 'Land',
  'addresses.zip': 'PLZ',
};

const OPERATOR_LABELS: Record<GroupRuleOperator, string> = {
  contains: 'enthält',
  equals: 'ist gleich',
  starts_with: 'beginnt mit',
  is_empty: 'ist leer',
  is_not_empty: 'ist nicht leer',
};

const VALUE_LESS: GroupRuleOperator[] = ['is_empty', 'is_not_empty'];

function emptyRule(): GroupRule {
  return { field: 'family_name', operator: 'contains', value: '' };
}

const inputCls = 'bg-surface-raised border border-divider rounded-md px-2 py-1 text-[13px] focus:outline-none focus:ring-1 focus:ring-accent';
const selectCls = inputCls + ' cursor-pointer';

export function GroupEditorModal({ initial, onSave, onClose }: GroupEditorModalProps) {
  const [name, setName] = useState(initial?.name ?? '');
  const [match, setMatch] = useState<'all' | 'any'>(initial?.match ?? 'all');
  const [rules, setRules] = useState<GroupRule[]>(initial?.rules.length ? initial.rules : [emptyRule()]);
  const [error, setError] = useState<string | null>(null);
  const { closing, requestClose } = useModalClose(onClose);

  function updateRule(i: number, patch: Partial<GroupRule>) {
    setRules((prev) => prev.map((r, j) => j === i ? { ...r, ...patch } : r));
  }

  function removeRule(i: number) {
    setRules((prev) => prev.filter((_, j) => j !== i));
  }

  function handleSave() {
    if (!name.trim()) { setError('Bitte einen Namen angeben.'); return; }
    if (rules.length === 0) { setError('Mindestens eine Regel erforderlich.'); return; }
    const invalid = rules.find((r) => !VALUE_LESS.includes(r.operator) && !r.value.trim());
    if (invalid) { setError('Bitte alle Regelwerte ausfüllen.'); return; }

    requestClose(() => onSave({
      id: initial?.id ?? crypto.randomUUID(),
      name: name.trim(),
      match,
      rules,
    }));
  }

  return (
    <div
      className={`modal-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/40 ${closing ? 'closing' : ''}`}
      onMouseDown={(e) => { if (e.target === e.currentTarget) requestClose(); }}
    >
      <div className={`modal-panel bg-surface w-full max-w-md rounded-xl shadow-2xl overflow-hidden flex flex-col ${closing ? 'closing' : ''}`}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-divider shrink-0">
          <h2 className="font-fraunces text-[18px] font-medium">
            {initial ? 'Gruppe bearbeiten' : 'Neue Gruppe'}
          </h2>
          <button
            onClick={() => requestClose()}
            className="press text-muted hover:text-foreground w-7 h-7 flex items-center justify-center rounded-full hover:bg-divider"
          >✕</button>
        </div>

        <div className="px-6 py-5 space-y-5 overflow-y-auto">
          {/* Name */}
          <div className="space-y-1.5">
            <label className="font-mono text-[10px] tracking-widest uppercase text-muted">Name</label>
            <input
              className={inputCls + ' w-full'}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="z.B. Familie, Berlin, VIPs …"
              autoFocus
            />
          </div>

          {/* Match mode */}
          <div className="space-y-1.5">
            <label className="font-mono text-[10px] tracking-widest uppercase text-muted">Bedingung</label>
            <div className="flex gap-2">
              {(['all', 'any'] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setMatch(m)}
                  className={`px-3 py-1 rounded-md text-[12px] border transition-colors ${
                    match === m
                      ? 'bg-accent text-white border-accent'
                      : 'border-divider text-muted hover:text-foreground'
                  }`}
                >
                  {m === 'all' ? 'Alle Regeln' : 'Eine Regel'}
                </button>
              ))}
            </div>
          </div>

          {/* Rules */}
          <div className="space-y-1.5">
            <label className="font-mono text-[10px] tracking-widest uppercase text-muted">Regeln</label>
            <div className="space-y-2">
              {rules.map((rule, i) => (
                <div key={i} className="flex gap-2 items-center">
                  <select
                    className={selectCls}
                    value={rule.field}
                    onChange={(e) => updateRule(i, { field: e.target.value as GroupRuleField })}
                  >
                    {(Object.keys(FIELD_LABELS) as GroupRuleField[]).map((f) => (
                      <option key={f} value={f}>{FIELD_LABELS[f]}</option>
                    ))}
                  </select>

                  <select
                    className={selectCls}
                    value={rule.operator}
                    onChange={(e) => updateRule(i, { operator: e.target.value as GroupRuleOperator, value: '' })}
                  >
                    {(Object.keys(OPERATOR_LABELS) as GroupRuleOperator[]).map((op) => (
                      <option key={op} value={op}>{OPERATOR_LABELS[op]}</option>
                    ))}
                  </select>

                  {!VALUE_LESS.includes(rule.operator) && (
                    <input
                      className={inputCls + ' flex-1 min-w-0'}
                      value={rule.value}
                      onChange={(e) => updateRule(i, { value: e.target.value })}
                      placeholder="Wert …"
                    />
                  )}

                  {rules.length > 1 && (
                    <button
                      onClick={() => removeRule(i)}
                      className="text-muted hover:text-red-400 transition-colors shrink-0 text-[16px] leading-none"
                    >×</button>
                  )}
                </div>
              ))}

              <button
                onClick={() => setRules((prev) => [...prev, emptyRule()])}
                className="text-[12px] text-accent hover:text-accent-dim transition-colors"
              >
                + Regel hinzufügen
              </button>
            </div>
          </div>

          {error && <p className="text-red-400 text-[12px]">{error}</p>}
        </div>

        <div className="flex justify-end gap-2 px-6 py-4 border-t border-divider shrink-0">
          <button
            onClick={() => requestClose()}
            className="press px-4 py-1.5 rounded-md text-[13px] text-muted hover:text-foreground hover:bg-surface-raised transition-colors"
          >Abbrechen</button>
          <button
            onClick={handleSave}
            className="press px-4 py-1.5 rounded-md text-[13px] bg-accent text-white hover:bg-accent-dim transition-colors"
          >Speichern</button>
        </div>
      </div>
    </div>
  );
}
