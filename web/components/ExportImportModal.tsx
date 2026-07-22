'use client';

import { useRef, useState } from 'react';
import type { AddressBook, ContactGroup } from '@/types/contact';
import { useModalClose } from './form-helpers';
import { Select } from './Select';

interface ExportImportModalProps {
  addressbooks: AddressBook[];
  manualGroups: ContactGroup[];
  onImported: () => void;
  onClose: () => void;
}

type Format = 'vcard' | 'csv';

interface ImportResult {
  created: number;
  errors: { line: number; message: string }[];
}

const inputCls = 'bg-surface-raised border border-divider rounded-md px-2 py-1 text-[13px] focus:outline-none focus:ring-1 focus:ring-accent';
const selectCls = inputCls + ' cursor-pointer';

export function ExportImportModal({ addressbooks, manualGroups, onImported, onClose }: ExportImportModalProps) {
  const { closing, requestClose } = useModalClose(onClose);

  const [exportFormat, setExportFormat] = useState<Format>('vcard');
  const [exportScope, setExportScope] = useState('all');

  const [importBookId, setImportBookId] = useState(addressbooks[0]?.id ?? '');
  const [importFormat, setImportFormat] = useState<Format>('vcard');
  const [file, setFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const scopeOptions = [
    { value: 'all', label: 'Alle Kontakte' },
    ...addressbooks.map((ab) => ({ value: `book:${ab.id}`, label: ab.display_name })),
    ...manualGroups.map((g) => ({ value: `mgroup:${g.id}`, label: `Gruppe: ${g.name}` })),
  ];

  function handleExport() {
    const params = new URLSearchParams({ format: exportFormat, scope: exportScope });
    const a = document.createElement('a');
    a.href = `/api/transfer/export?${params.toString()}`;
    a.click();
  }

  function handleFileChange(f: File | null) {
    setFile(f);
    setResult(null);
    if (f && /\.csv$/i.test(f.name)) setImportFormat('csv');
    else if (f && /\.(vcf|vcard)$/i.test(f.name)) setImportFormat('vcard');
  }

  async function handleImport() {
    if (!file || !importBookId) return;
    setImporting(true);
    setResult(null);
    try {
      const content = await file.text();
      const res = await fetch('/api/transfer/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ addressbook_id: importBookId, format: importFormat, content }),
      });
      if (res.ok) {
        const data: ImportResult = await res.json();
        setResult(data);
        if (data.created > 0) onImported();
      } else {
        setResult({ created: 0, errors: [{ line: 0, message: 'Import fehlgeschlagen.' }] });
      }
    } finally {
      setImporting(false);
    }
  }

  return (
    <div
      className={`modal-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/40 ${closing ? 'closing' : ''}`}
      onMouseDown={(e) => { if (e.target === e.currentTarget) requestClose(); }}
    >
      <div className={`modal-panel bg-surface w-full max-w-lg rounded-xl shadow-2xl overflow-hidden flex flex-col ${closing ? 'closing' : ''}`}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-divider shrink-0">
          <h2 className="font-fraunces text-[18px] font-medium">Export / Import</h2>
          <button
            onClick={() => requestClose()}
            className="press text-muted hover:text-foreground w-7 h-7 flex items-center justify-center rounded-full hover:bg-divider"
          >✕</button>
        </div>

        <div className="px-6 py-5 space-y-7 overflow-y-auto">
          {/* Export */}
          <div className="space-y-2.5">
            <h3 className="font-mono text-[10px] tracking-widest uppercase text-accent-dim">Export</h3>
            <div className="flex gap-2">
              {(['vcard', 'csv'] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setExportFormat(f)}
                  className={`px-3 py-1 rounded-md text-[12px] border transition-colors ${
                    exportFormat === f
                      ? 'bg-accent text-white border-accent'
                      : 'border-divider text-muted hover:text-foreground'
                  }`}
                >
                  {f === 'vcard' ? 'vCard' : 'CSV'}
                </button>
              ))}
            </div>
            <Select
              value={exportScope}
              onValueChange={setExportScope}
              options={scopeOptions}
              triggerClassName={selectCls + ' w-full inline-flex items-center justify-between'}
            />
            <button
              onClick={handleExport}
              className="press w-full px-4 py-1.5 rounded-md text-[13px] bg-accent text-white hover:bg-accent-dim transition-colors"
            >Exportieren</button>
          </div>

          {/* Import */}
          <div className="space-y-2.5 pt-5 border-t border-divider-soft">
            <h3 className="font-mono text-[10px] tracking-widest uppercase text-accent-dim">Import</h3>
            <Select
              value={importBookId}
              onValueChange={setImportBookId}
              options={addressbooks.map((ab) => ({ value: ab.id, label: ab.display_name }))}
              placeholder="Ziel-Adressbuch"
              triggerClassName={selectCls + ' w-full inline-flex items-center justify-between'}
            />
            <input
              ref={fileInputRef}
              type="file"
              accept=".vcf,.vcard,.csv"
              onChange={(e) => handleFileChange(e.target.files?.[0] ?? null)}
              className="text-[13px] text-muted w-full file:mr-3 file:px-3 file:py-1 file:rounded-md file:border file:border-divider file:bg-surface-raised file:text-foreground file:text-[12px] file:cursor-pointer cursor-pointer"
            />
            {file && (
              <div className="flex gap-2">
                {(['vcard', 'csv'] as const).map((f) => (
                  <button
                    key={f}
                    onClick={() => setImportFormat(f)}
                    className={`px-3 py-1 rounded-md text-[12px] border transition-colors ${
                      importFormat === f
                        ? 'bg-accent text-white border-accent'
                        : 'border-divider text-muted hover:text-foreground'
                    }`}
                  >
                    {f === 'vcard' ? 'vCard' : 'CSV'}
                  </button>
                ))}
              </div>
            )}
            <button
              onClick={handleImport}
              disabled={!file || !importBookId || importing}
              className="press w-full px-4 py-1.5 rounded-md text-[13px] bg-accent text-white hover:bg-accent-dim transition-colors disabled:opacity-40 disabled:cursor-default"
            >{importing ? 'Importiere …' : 'Importieren'}</button>

            {result && (
              <div className="text-[12.5px] space-y-1 pt-1">
                <p className="text-sage">{result.created} Kontakt(e) importiert.</p>
                {result.errors.length > 0 && (
                  <div className="text-red-400">
                    <p>{result.errors.length} Fehler:</p>
                    <ul className="list-disc list-inside">
                      {result.errors.slice(0, 8).map((e, i) => (
                        <li key={i}>{e.line > 0 ? `Zeile ${e.line}: ` : ''}{e.message}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-2 px-6 py-4 border-t border-divider shrink-0">
          <button
            onClick={() => requestClose()}
            className="press px-4 py-1.5 rounded-md text-[13px] text-muted hover:text-foreground hover:bg-surface-raised transition-colors"
          >Schließen</button>
        </div>
      </div>
    </div>
  );
}
