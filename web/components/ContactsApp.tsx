'use client';

import { useState, useMemo, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import type { Contact, AddressBook, SmartCollection, SmartGroup } from '@/types/contact';
import { syncContacts } from '@/app/actions';
import { Sidebar } from './Sidebar';
import { ContactList } from './ContactList';
import { DetailPane } from './DetailPane';
import { NewContactModal } from './NewContactModal';
import { GroupEditorModal } from './GroupEditorModal';
import { DedupModal } from './DedupModal';
import { useSmartGroups, applySmartGroup } from './useSmartGroups';

interface ContactsAppProps {
  initialContacts: Contact[];
  initialAddressbooks: AddressBook[];
}

export function ContactsApp({ initialContacts, initialAddressbooks }: ContactsAppProps) {
  const router = useRouter();
  const [contacts, setContacts] = useState(initialContacts);
  const [addressbooks, setAddressbooks] = useState(initialAddressbooks);
  const [selected, setSelected] = useState<string | SmartCollection>('all');
  const [selectedUid, setSelectedUid] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [syncStatus, setSyncStatus] = useState<'synced' | 'syncing' | 'error'>('synced');
  const [showNewContact, setShowNewContact] = useState(false);
  const [editingGroup, setEditingGroup] = useState<SmartGroup | null | 'new'>(null);
  const [showDedup, setShowDedup] = useState(false);

  const { groups: smartGroups, addGroup, updateGroup, deleteGroup } = useSmartGroups();

  useEffect(() => {
    setContacts(initialContacts);
  }, [initialContacts]);

  const filtered = useMemo(() => {
    let result = contacts;
    if (selected === 'recent') {
      result = [...contacts].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 20);
    } else if (selected === 'birthdays') {
      result = contacts.filter((c) => c.birthday);
    } else if (selected === 'no-photo') {
      result = contacts.filter((c) => !c.photo_data_uri);
    } else if (typeof selected === 'string' && selected.startsWith('group:')) {
      const groupId = selected.slice(6);
      const group = smartGroups.find((g) => g.id === groupId);
      result = group ? applySmartGroup(contacts, group) : [];
    } else if (selected !== 'all') {
      result = contacts.filter((c) => c.addressbook_id === selected);
    }
    return result;
  }, [contacts, selected, smartGroups]);

  const recentCount = useMemo(
    () => [...contacts].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 20).length,
    [contacts]
  );
  const birthdayCount = useMemo(() => contacts.filter((c) => c.birthday).length, [contacts]);
  const noPhotoCount = useMemo(() => contacts.filter((c) => !c.photo_data_uri).length, [contacts]);

  const groupCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const g of smartGroups) {
      counts[g.id] = applySmartGroup(contacts, g).length;
    }
    return counts;
  }, [contacts, smartGroups]);

  const selectedContact = selectedUid ? contacts.find((c) => c.uid === selectedUid) ?? null : null;

  function handleUpdate(updated: Contact) {
    setContacts((prev) => prev.map((c) => (c.uid === updated.uid ? updated : c)));
  }

  function handleDelete(uid: string) {
    setContacts((prev) => prev.filter((c) => c.uid !== uid));
    setSelectedUid(null);
  }

  function handleCreate(contact: Contact) {
    setContacts((prev) => [...prev, contact]);
    setSelectedUid(contact.uid);
    setShowNewContact(false);
  }

  async function moveContact(uid: string, targetBookId: string) {
    try {
      const sourceBookId = contacts.find((c) => c.uid === uid)?.addressbook_id;
      const res = await fetch(`/api/contacts/${encodeURIComponent(uid)}/move`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ addressbook_id: targetBookId }),
      });
      if (!res.ok) return;
      const updated: Contact = await res.json();
      setContacts((prev) => prev.map((c) => (c.uid === uid ? updated : c)));
      if (sourceBookId && sourceBookId !== targetBookId) {
        setAddressbooks((prev) => prev.map((ab) => {
          if (ab.id === sourceBookId) return { ...ab, contact_count: ab.contact_count - 1 };
          if (ab.id === targetBookId) return { ...ab, contact_count: ab.contact_count + 1 };
          return ab;
        }));
      }
    } catch {
      // ignore
    }
  }

  async function mergeContacts(keep: Contact, discard: Contact) {
    await fetch(`/api/contacts/${encodeURIComponent(discard.uid)}`, { method: 'DELETE' });
    setContacts((prev) => prev.filter((c) => c.uid !== discard.uid));
    if (selectedUid === discard.uid) setSelectedUid(keep.uid);
  }

  async function handleSync() {
    if (syncStatus === 'syncing') return;
    setSyncStatus('syncing');
    const { ok } = await syncContacts();
    setSyncStatus(ok ? 'synced' : 'error');
    if (ok) router.refresh();
    else setTimeout(() => setSyncStatus('synced'), 5000);
  }

  return (
    <div className="grid h-screen overflow-hidden" style={{ gridTemplateColumns: '220px 300px 1fr', gridTemplateRows: '1fr' }}>
      {showNewContact && (
        <NewContactModal
          addressbooks={addressbooks}
          onClose={() => setShowNewContact(false)}
          onCreate={handleCreate}
        />
      )}
      {showDedup && (
        <DedupModal
          contacts={contacts}
          onMerge={mergeContacts}
          onClose={() => setShowDedup(false)}
        />
      )}
      {editingGroup !== null && (
        <GroupEditorModal
          initial={editingGroup === 'new' ? undefined : (editingGroup as SmartGroup)}
          onSave={(g) => {
            editingGroup === 'new' ? addGroup(g) : updateGroup(g);
            setEditingGroup(null);
          }}
          onClose={() => setEditingGroup(null)}
        />
      )}
      <Sidebar
        addressbooks={addressbooks}
        selected={selected}
        onSelect={(id) => { setSelected(id); setSelectedUid(null); }}
        recentCount={recentCount}
        birthdayCount={birthdayCount}
        noPhotoCount={noPhotoCount}
        syncStatus={syncStatus}
        onSync={handleSync}
        onMoveContact={moveContact}
        smartGroups={smartGroups}
        groupCounts={groupCounts}
        onNewGroup={() => setEditingGroup('new')}
        onEditGroup={(g) => setEditingGroup(g)}
        onDeleteGroup={(id) => {
          deleteGroup(id);
          if (selected === `group:${id}`) setSelected('all');
        }}
        onDedup={() => setShowDedup(true)}
      />
      <ContactList
        contacts={filtered}
        selectedUid={selectedUid}
        onSelect={setSelectedUid}
        search={search}
        onSearchChange={setSearch}
        onNew={() => setShowNewContact(true)}
        view={selected === 'birthdays' ? 'birthday' : 'default'}
      />
      <DetailPane contact={selectedContact} onUpdate={handleUpdate} onDelete={handleDelete} />
    </div>
  );
}
