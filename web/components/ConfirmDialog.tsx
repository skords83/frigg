'use client';

import { useModalClose } from './form-helpers';

interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onClose: () => void;
}

export function ConfirmDialog({ title, message, confirmLabel = 'Löschen', onConfirm, onClose }: ConfirmDialogProps) {
  const { closing, requestClose } = useModalClose(onClose);

  return (
    <div
      className={`modal-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/40 ${closing ? 'closing' : ''}`}
      onMouseDown={(e) => { if (e.target === e.currentTarget) requestClose(); }}
    >
      <div className={`modal-panel bg-surface w-full max-w-sm rounded-xl shadow-2xl overflow-hidden flex flex-col ${closing ? 'closing' : ''}`}>
        <div className="px-6 py-5">
          <h2 className="font-fraunces text-[18px] font-medium mb-2">{title}</h2>
          <p className="text-[13px] text-muted leading-relaxed">{message}</p>
        </div>
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-divider shrink-0">
          <button
            onClick={() => requestClose()}
            className="press px-4 py-1.5 rounded-md text-[13px] text-muted hover:text-foreground hover:bg-surface-raised transition-colors"
          >Abbrechen</button>
          <button
            onClick={() => requestClose(onConfirm)}
            className="press px-4 py-1.5 rounded-md text-[13px] bg-red-500/90 text-white hover:bg-red-500 transition-colors"
          >{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
