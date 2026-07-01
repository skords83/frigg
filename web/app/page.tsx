import { ContactsApp } from '@/components/ContactsApp';
import type { Contact, AddressBook } from '@/types/contact';

const apiUrl = process.env.API_URL || 'http://localhost:3001';

async function getData(): Promise<{ contacts: Contact[]; addressbooks: AddressBook[] }> {
  try {
    const [contactsRes, addressbooksRes] = await Promise.all([
      fetch(`${apiUrl}/api/contacts`, { next: { revalidate: 30 } }),
      fetch(`${apiUrl}/api/addressbooks`, { next: { revalidate: 30 } }),
    ]);
    if (!contactsRes.ok || !addressbooksRes.ok) {
      return { contacts: [], addressbooks: [] };
    }
    const [contacts, addressbooks] = await Promise.all([
      contactsRes.json(),
      addressbooksRes.json(),
    ]);
    return {
      contacts: Array.isArray(contacts) ? contacts : [],
      addressbooks: Array.isArray(addressbooks) ? addressbooks : [],
    };
  } catch {
    return { contacts: [], addressbooks: [] };
  }
}

export default async function Page() {
  const { contacts, addressbooks } = await getData();
  return <ContactsApp initialContacts={contacts} initialAddressbooks={addressbooks} />;
}
