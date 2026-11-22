'use client';
import { compareVersions, displayValue, fieldNames, type Choices, type EditContact } from './conflicts';
import { ActionButton } from './form-helpers';

export function ConflictReview({ base, mine, server, choices, onChoice, onSave, onCancel, saving }: {
  base: EditContact; mine: EditContact; server: EditContact; choices: Choices;
  onChoice: (choices: Choices) => void; onSave: () => void; onCancel: () => void; saving: boolean;
}) {
  const rows = compareVersions(base, mine, server).filter(r => r.mineChanged || r.serverChanged);
  const unresolved = rows.some(r => r.mineChanged && r.serverChanged && r.differs && !choices[r.key]);
  return <div role="region" aria-label="Änderungen vergleichen" className="space-y-4">
    <h3 className="font-fraunces text-[16px]">Zwischenzeitlich geändert</h3>
    <p className="text-[13px] text-muted">Unveränderte Felder werden vom Server übernommen. Bei beidseitigen Änderungen entscheidest du. Beim Speichern wird die Version erneut geprüft.</p>
    {rows.map(row => <fieldset key={row.key} className="border border-divider rounded-lg p-3 space-y-2" disabled={saving}>
      <legend className="font-mono text-[11px] px-1">{fieldNames[row.key]}</legend>
      <p className="text-[12px] text-muted">{row.mineChanged ? 'Von dir geändert' : 'Von dir unverändert'} · {row.serverChanged ? 'Auf dem Server geändert' : 'Auf dem Server unverändert'}</p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-[13px] whitespace-pre-wrap break-words">
        <div><p className="font-mono text-[10px] text-muted">URSPRÜNGLICH</p><span>{displayValue(row.key, base[row.key])}</span></div>
        <div><p className="font-mono text-[10px] text-muted">DEINE VERSION</p><span>{displayValue(row.key, mine[row.key])}</span></div>
        <div><p className="font-mono text-[10px] text-muted">AKTUELLER SERVER</p><span>{displayValue(row.key, server[row.key])}</span></div>
      </div>
      {row.key === 'photo_data_uri' && <div className="flex gap-3">{[base, mine, server].map((c,i) => c.photo_data_uri ? <img key={i} src={c.photo_data_uri} alt={['Ursprüngliches Foto','Dein Foto','Serverfoto'][i]} className="w-16 h-16 rounded-full object-cover" /> : <span key={i} className="w-16 text-[12px] text-muted">Kein Foto</span>)}</div>}
      {row.mineChanged && row.serverChanged && row.differs ? <div className="flex flex-wrap gap-3 text-[13px]">
        <label><input className="accent-accent" type="radio" name={`conflict-${row.key}`} checked={choices[row.key] === 'mine'} onChange={() => onChoice({ ...choices, [row.key]: 'mine' })} /> Meine Änderung verwenden</label>
        <label><input className="accent-accent" type="radio" name={`conflict-${row.key}`} checked={choices[row.key] === 'server'} onChange={() => onChoice({ ...choices, [row.key]: 'server' })} /> Serverversion behalten</label>
      </div> : <p className="text-[12px] text-muted">{row.mineChanged ? 'Deine Änderung wird übernommen.' : 'Die Serverversion wird übernommen.'}</p>}
    </fieldset>)}
    <div className="flex justify-end gap-2"><ActionButton label="Zurück zur Bearbeitung" onClick={onCancel} disabled={saving} /><ActionButton label={saving ? 'Speichert …' : 'Auswahl speichern'} variant="primary" onClick={onSave} disabled={saving || unresolved} /></div>
  </div>;
}
