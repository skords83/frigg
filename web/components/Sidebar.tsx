'use client';

import { useState } from 'react';
import type { AddressBook, SmartCollection, SmartGroup } from '@/types/contact';

interface SidebarProps {
  addressbooks: AddressBook[];
  selected: string | SmartCollection;
  onSelect: (id: string | SmartCollection) => void;
  recentCount: number;
  birthdayCount: number;
  noPhotoCount: number;
  syncStatus: 'synced' | 'syncing' | 'error';
  onSync: () => void;
  onMoveContact: (uid: string, targetBookId: string) => void;
  smartGroups: SmartGroup[];
  groupCounts: Record<string, number>;
  onNewGroup: () => void;
  onEditGroup: (group: SmartGroup) => void;
  onDeleteGroup: (id: string) => void;
  onDedup: () => void;
}

export function Sidebar({
  addressbooks,
  selected,
  onSelect,
  recentCount,
  birthdayCount,
  noPhotoCount,
  syncStatus,
  onSync,
  onMoveContact,
  smartGroups,
  groupCounts,
  onNewGroup,
  onEditGroup,
  onDeleteGroup,
  onDedup,
}: SidebarProps) {
  const allCount = addressbooks.reduce((sum, ab) => sum + ab.contact_count, 0);

  return (
    <aside className="bg-surface border-r border-divider-soft flex flex-col py-6 px-4">
      {/* Brand */}
      <div className="flex items-center gap-2.5 mb-8 pl-1">
        <div
          className="brand-mark w-[26px] h-[26px] border border-accent rounded-full flex items-center justify-center font-fraunces text-[13px] text-accent relative"
          style={{ borderWidth: '1.5px' }}
        >
          F
        </div>
        <span className="font-fraunces text-[19px] font-medium tracking-wide">Frigg</span>
      </div>

      {/* Address books */}
      <SectionLabel>Adressbücher</SectionLabel>
      <ul role="listbox" aria-label="Adressbücher">
        <SidebarItem
          label="Alle Kontakte"
          count={allCount}
          active={selected === 'all'}
          onClick={() => onSelect('all')}
        />
        {addressbooks.map((ab) => (
          <SidebarItem
            key={ab.id}
            label={ab.display_name}
            count={ab.contact_count}
            active={selected === ab.id}
            onClick={() => onSelect(ab.id)}
            onDrop={(uid) => onMoveContact(uid, ab.id)}
          />
        ))}
      </ul>

      {/* Smart collections */}
      <SectionLabel>Sammlungen</SectionLabel>
      <ul role="listbox" aria-label="Sammlungen">
        <SidebarItem
          label="Zuletzt hinzugefügt"
          count={recentCount}
          active={selected === 'recent'}
          onClick={() => onSelect('recent')}
        />
        <SidebarItem
          label="Geburtstage"
          count={birthdayCount || undefined}
          active={selected === 'birthdays'}
          onClick={() => onSelect('birthdays')}
        />
        <SidebarItem
          label="Ohne Foto"
          count={noPhotoCount}
          active={selected === 'no-photo'}
          onClick={() => onSelect('no-photo')}
        />
      </ul>

      {/* Smart groups */}
      <div className="flex items-center justify-between mt-5 mb-2 px-2">
        <p className="font-mono text-[10px] tracking-widest uppercase text-muted">Gruppen</p>
        <button
          onClick={onNewGroup}
          className="text-muted hover:text-foreground text-[16px] leading-none transition-colors"
          title="Neue Gruppe"
        >+</button>
      </div>
      {smartGroups.length === 0 && (
        <p className="text-[12px] text-muted px-2 italic">Keine Gruppen</p>
      )}
      <ul role="listbox" aria-label="Gruppen">
        {smartGroups.map((g) => (
          <GroupItem
            key={g.id}
            group={g}
            count={groupCounts[g.id] ?? 0}
            active={selected === `group:${g.id}`}
            onClick={() => onSelect(`group:${g.id}`)}
            onEdit={() => onEditGroup(g)}
            onDelete={() => onDeleteGroup(g.id)}
          />
        ))}
      </ul>

      {/* Dedup trigger */}
      <button
        onClick={onDedup}
        className="mt-4 text-left px-2 py-1.5 rounded-md text-[13px] text-muted hover:bg-surface-raised hover:text-foreground transition-colors w-full flex items-center gap-2"
      >
        <span className="opacity-50 text-[11px]">⊕</span>
        Duplikate prüfen
      </button>

      {/* Footer sync status */}
      <button
        onClick={onSync}
        disabled={syncStatus === 'syncing'}
        className="press mt-auto pt-3.5 border-t border-divider-soft flex items-center gap-1.5 font-mono text-[11px] text-muted w-full text-left hover:text-foreground transition-colors disabled:cursor-default cursor-pointer"
      >
        <span
          className={`w-1.5 h-1.5 rounded-full shrink-0 ${
            syncStatus === 'synced'
              ? 'bg-sage shadow-[0_0_6px_var(--sage)]'
              : syncStatus === 'syncing'
              ? 'bg-accent animate-pulse'
              : 'bg-red-500'
          }`}
        />
        baikal.skords.de · {syncStatus === 'syncing' ? 'syncing…' : syncStatus === 'error' ? 'Fehler · retry' : 'synced'}
      </button>
    </aside>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="font-mono text-[10px] tracking-widest uppercase text-muted px-2 mb-2 mt-5">
      {children}
    </p>
  );
}

function GroupItem({
  group,
  count,
  active,
  onClick,
  onEdit,
  onDelete,
}: {
  group: SmartGroup;
  count: number;
  active: boolean;
  onClick: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <li className="relative">
      <button
        role="option"
        aria-selected={active}
        onClick={onClick}
        onContextMenu={(e) => { e.preventDefault(); setMenuOpen(true); }}
        className={`w-full text-left px-2 py-1.5 rounded-md text-[13.5px] flex justify-between items-center transition-colors group ${
          active
            ? 'bg-surface-raised text-foreground shadow-[inset_2px_0_0_var(--accent)]'
            : 'text-muted hover:bg-surface-raised hover:text-foreground'
        }`}
      >
        <span className="flex items-center gap-1.5">
          <span className="opacity-50 text-[11px]">◆</span>
          {group.name}
        </span>
        <span className="flex items-center gap-1">
          <span className="font-mono text-[10.5px] text-muted opacity-70">{count}</span>
          <button
            onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v); }}
            className="opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity text-[14px] leading-none px-0.5"
          >⋯</button>
        </span>
      </button>
      {menuOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
          <div className="popover-in absolute left-2 top-full z-50 mt-0.5 bg-surface border border-divider rounded-lg shadow-lg py-1 min-w-[120px]">
            <button
              onClick={() => { setMenuOpen(false); onEdit(); }}
              className="w-full text-left px-3 py-1.5 text-[13px] hover:bg-surface-raised transition-colors"
            >Bearbeiten</button>
            <button
              onClick={() => { setMenuOpen(false); onDelete(); }}
              className="w-full text-left px-3 py-1.5 text-[13px] text-red-400 hover:bg-surface-raised transition-colors"
            >Löschen</button>
          </div>
        </>
      )}
    </li>
  );
}

function SidebarItem({
  label,
  count,
  active,
  onClick,
  onDrop,
}: {
  label: string;
  count?: number;
  active: boolean;
  onClick: () => void;
  onDrop?: (uid: string) => void;
}) {
  const [dragOver, setDragOver] = useState(false);

  return (
    <li
      onDragOver={onDrop ? (e) => { e.preventDefault(); setDragOver(true); } : undefined}
      onDragLeave={onDrop ? () => setDragOver(false) : undefined}
      onDrop={onDrop ? (e) => {
        e.preventDefault();
        setDragOver(false);
        const uid = e.dataTransfer.getData('text/x-contact-uid');
        if (uid) onDrop(uid);
      } : undefined}
    >
      <button
        role="option"
        aria-selected={active}
        onClick={onClick}
        className={`w-full text-left px-2 py-1.5 rounded-md text-[13.5px] flex justify-between items-center transition-colors
          ${active
            ? 'bg-surface-raised text-foreground shadow-[inset_2px_0_0_var(--accent)]'
            : dragOver
            ? 'bg-surface-raised text-foreground ring-1 ring-inset ring-accent'
            : 'text-muted hover:bg-surface-raised hover:text-foreground'
          }`}
      >
        <span>{label}</span>
        {count !== undefined && (
          <span className="font-mono text-[10.5px] text-muted opacity-70">{count}</span>
        )}
      </button>
    </li>
  );
}
