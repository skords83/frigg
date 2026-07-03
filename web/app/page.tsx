import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { ContactsApp } from '@/components/ContactsApp';
import type { Contact, AddressBook } from '@/types/contact';

const apiUrl = process.env.API_URL || 'http://localhost:3001';

async function getData(): Promise<{ contacts: Contact[]; addressbooks: AddressBook[] }> {
  const cookieHeader = (await cookies()).toString();
  // Data is per-user (access-controlled by session), so this must never be
  // shared across requests — no revalidate/cache.
  let contactsRes: Response;
  let addressbooksRes: Response;
  try {
    [contactsRes, addressbooksRes] = await Promise.all([
      fetch(`${apiUrl}/api/contacts`, { headers: { Cookie: cookieHeader }, cache: 'no-store' }),
      fetch(`${apiUrl}/api/addressbooks`, { headers: { Cookie: cookieHeader }, cache: 'no-store' }),
    ]);
  } catch {
    return { contacts: [], addressbooks: [] };
  }
  if (contactsRes.status === 401 || addressbooksRes.status === 401) {
    redirect('/login');
  }
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
}

export default async function Page() {
  const { contacts, addressbooks } = await getData();
  return <ContactsApp initialContacts={contacts} initialAddressbooks={addressbooks} />;
}
