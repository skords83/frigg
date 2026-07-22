'use client';

import { useState, useMemo, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import type { Contact, AddressBook, SmartCollection, SmartGroup, ContactGroup } from '@/types/contact';
import { syncContacts, invalidateContacts } from '@/app/actions';
import { Sidebar } from './Sidebar';
import { ContactList } from './ContactList';
import { DetailPane } from './DetailPane';
import { NewContactModal } from './NewContactModal';
import { GroupEditorModal } from './GroupEditorModal';
import { ManualGroupModal } from './ManualGroupModal';
import { ExportImportModal } from './ExportImportModal';
import { DedupModal } from './DedupModal';
import { useSmartGroups, applySmartGroup } from './useSmartGroups';
import { useGroups } from './useGroups';

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
  const [editingManualGroup, setEditingManualGroup] = useState<ContactGroup | null | 'new'>(null);
  const [showDedup, setShowDedup] = useState(false);
  const [showExportImport, setShowExportImport] = useState(false);

  const { groups: smartGroups, addGroup, updateGroup, deleteGroup } = useSmartGroups();
  const { groups: manualGroups, createGroup: createManualGroup, renameGroup: renameManualGroup, deleteGroup: deleteManualGroup, addMember, removeMember } = useGroups();

  useEffect(() => {
    setContacts(initialContacts);
  }, [initialContacts]);

  useEffect(() => {
    setAddressbooks(initialAddressbooks);
  }, [initialAddressbooks]);

  const filtered = useMemo(() => {
    let result = contacts;
    if (selected === 'recent') {
      result = [...contacts].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 20);
    } else if (selected === 'birthdays') {
      result = contacts.filter((c) => c.birthday);
    } else if (selected === 'no-photo') {
      result = contacts.filter((c) => !c.has_photo);
    } else if (typeof selected === 'string' && selected.startsWith('group:')) {
      const groupId = selected.slice(6);
      const group = smartGroups.find((g) => g.id === groupId);
      result = group ? applySmartGroup(contacts, group) : [];
    } else if (typeof selected === 'string' && selected.startsWith('mgroup:')) {
      const groupId = selected.slice(7);
      const group = manualGroups.find((g) => g.id === groupId);
      result = group ? contacts.filter((c) => group.member_uids.includes(c.uid)) : [];
    } else if (selected !== 'all') {
      result = contacts.filter((c) => c.addressbook_id === selected);
    }
    return result;
  }, [contacts, selected, smartGroups, manualGroups]);

  const recentCount = useMemo(
    () => [...contacts].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 20).length,
    [contacts]
  );
  const birthdayCount = useMemo(() => contacts.filter((c) => c.birthday).length, [contacts]);
  const noPhotoCount = useMemo(() => contacts.filter((c) => !c.has_photo).length, [contacts]);

  const groupCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const g of smartGroups) {
      counts[g.id] = applySmartGroup(contacts, g).length;
    }
    return counts;
  }, [contacts, smartGroups]);

  const manualGroupCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const g of manualGroups) {
      counts[g.id] = g.member_uids.length;
    }
    return counts;
  }, [manualGroups]);

  const addressbookCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const c of contacts) {
      counts[c.addressbook_id] = (counts[c.addressbook_id] ?? 0) + 1;
    }
    return counts;
  }, [contacts]);

  const selectedContact = selectedUid ? contacts.find((c) => c.uid === selectedUid) ?? null : null;

  function handleUpdate(updated: Contact) {
    setContacts((prev) => prev.map((c) => (c.uid === updated.uid ? updated : c)));
  }

  function handleDelete(uid: string) {
    setContacts((prev) => prev.filter((c) => c.uid !== uid));
    setSelectedUid(null);
    invalidateContacts().then(() => router.refresh());
  }

  function handleCreate(contact: Contact) {
    setContacts((prev) => [...prev, contact]);
    setSelectedUid(contact.uid);
    setShowNewContact(false);
    invalidateContacts().then(() => router.refresh());
  }

  async function moveContact(uid: string, targetBookId: string) {
    try {
      const res = await fetch(`/api/contacts/${encodeURIComponent(uid)}/move`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ addressbook_id: targetBookId }),
      });
      if (!res.ok) return;
      const updated: Contact = await res.json();
      setContacts((prev) => prev.map((c) => (c.uid === uid ? updated : c)));
    } catch {
      // ignore
    }
  }

  async function mergeContacts(keep: Contact, discard: Contact) {
    await fetch(`/api/contacts/${encodeURIComponent(discard.uid)}`, { method: 'DELETE' });
    setContacts((prev) => prev.filter((c) => c.uid !== discard.uid));
    if (selectedUid === discard.uid) setSelectedUid(keep.uid);
    invalidateContacts().then(() => router.refresh());
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
      {editingManualGroup !== null && (
        <ManualGroupModal
          initial={editingManualGroup === 'new' ? undefined : (editingManualGroup as ContactGroup)}
          onSave={(name) => {
            if (editingManualGroup === 'new') createManualGroup(name);
            else renameManualGroup((editingManualGroup as ContactGroup).id, name);
            setEditingManualGroup(null);
          }}
          onClose={() => setEditingManualGroup(null)}
        />
      )}
      {showExportImport && (
        <ExportImportModal
          addressbooks={addressbooks}
          manualGroups={manualGroups}
          onImported={() => invalidateContacts().then(() => router.refresh())}
          onClose={() => setShowExportImport(false)}
        />
      )}
      <Sidebar
        addressbooks={addressbooks}
        addressbookCounts={addressbookCounts}
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
        manualGroups={manualGroups}
        manualGroupCounts={manualGroupCounts}
        onNewManualGroup={() => setEditingManualGroup('new')}
        onRenameManualGroup={(g) => setEditingManualGroup(g)}
        onDeleteManualGroup={(id) => {
          deleteManualGroup(id);
          if (selected === `mgroup:${id}`) setSelected('all');
        }}
        onDedup={() => setShowDedup(true)}
        onExportImport={() => setShowExportImport(true)}
      />
      <ContactList
        contacts={filtered}
        selectedUid={selectedUid}
        onSelect={setSelectedUid}
        search={search}
        onSearchChange={setSearch}
        onNew={() => setShowNewContact(true)}
        view={selected === 'birthdays' ? 'birthday' : selected === 'recent' ? 'recent' : 'default'}
      />
      <DetailPane
        contact={selectedContact}
        onUpdate={handleUpdate}
        onDelete={handleDelete}
        groups={manualGroups}
        onAddToGroup={addMember}
        onRemoveFromGroup={removeMember}
      />
    </div>
  );
}
