'use client';

import type { AddressBook, SmartCollection } from '@/types/contact';

interface SidebarProps {
  addressbooks: AddressBook[];
  selected: string | SmartCollection;
  onSelect: (id: string | SmartCollection) => void;
  recentCount: number;
  birthdayCount: number;
  noPhotoCount: number;
  syncStatus: 'synced' | 'syncing' | 'error';
  onSync: () => void;
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

      {/* Footer sync status */}
      <button
        onClick={onSync}
        disabled={syncStatus === 'syncing'}
        className="mt-auto pt-3.5 border-t border-divider-soft flex items-center gap-1.5 font-mono text-[11px] text-muted w-full text-left hover:text-foreground transition-colors disabled:cursor-default cursor-pointer"
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
        baikal.skords.de · {syncStatus === 'syncing' ? 'syncing…' : syncStatus}
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

function SidebarItem({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count?: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <li>
      <button
        role="option"
        aria-selected={active}
        onClick={onClick}
        className={`w-full text-left px-2 py-1.5 rounded-md text-[13.5px] flex justify-between items-center transition-colors
          ${active
            ? 'bg-surface-raised text-foreground shadow-[inset_2px_0_0_var(--accent)]'
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
