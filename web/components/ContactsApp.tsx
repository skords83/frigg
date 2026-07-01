'use client';

import { useState, useMemo } from 'react';
import type { Contact, AddressBook, SmartCollection } from '@/types/contact';
import { Sidebar } from './Sidebar';
import { ContactList } from './ContactList';
import { DetailPane } from './DetailPane';

interface ContactsAppProps {
  initialContacts: Contact[];
  initialAddressbooks: AddressBook[];
}

export function ContactsApp({ initialContacts, initialAddressbooks }: ContactsAppProps) {
  const [contacts, setContacts] = useState(initialContacts);
  const [addressbooks] = useState(initialAddressbooks);
  const [selected, setSelected] = useState<string | SmartCollection>('all');
  const [selectedUid, setSelectedUid] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [syncStatus] = useState<'synced' | 'syncing' | 'error'>('synced');

  const filtered = useMemo(() => {
    let result = contacts;
    if (selected === 'recent') {
      result = [...contacts].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 20);
    } else if (selected === 'birthdays') {
      result = contacts.filter((c) => c.birthday);
    } else if (selected === 'no-photo') {
      result = contacts.filter((c) => !c.photo_data_uri);
    } else if (selected !== 'all') {
      result = contacts.filter((c) => c.addressbook_id === selected);
    }
    return result;
  }, [contacts, selected]);

  const recentCount = useMemo(
    () => [...contacts].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 20).length,
    [contacts]
  );
  const birthdayCount = useMemo(() => contacts.filter((c) => c.birthday).length, [contacts]);
  const noPhotoCount = useMemo(() => contacts.filter((c) => !c.photo_data_uri).length, [contacts]);

  const selectedContact = selectedUid ? contacts.find((c) => c.uid === selectedUid) ?? null : null;

  function handleUpdate(updated: Contact) {
    setContacts((prev) => prev.map((c) => (c.uid === updated.uid ? updated : c)));
  }

  function handleDelete(uid: string) {
    setContacts((prev) => prev.filter((c) => c.uid !== uid));
    setSelectedUid(null);
  }

  return (
    <div className="grid h-screen overflow-hidden" style={{ gridTemplateColumns: '220px 300px 1fr' }}>
      <Sidebar
        addressbooks={addressbooks}
        selected={selected}
        onSelect={(id) => { setSelected(id); setSelectedUid(null); }}
        recentCount={recentCount}
        birthdayCount={birthdayCount}
        noPhotoCount={noPhotoCount}
        syncStatus={syncStatus}
      />
      <ContactList
        contacts={filtered}
        selectedUid={selectedUid}
        onSelect={setSelectedUid}
        search={search}
        onSearchChange={setSearch}
      />
      <DetailPane contact={selectedContact} onUpdate={handleUpdate} onDelete={handleDelete} />
    </div>
  );
}
