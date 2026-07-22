export interface PhoneEntry {
  label: string;
  value: string;
}

export interface EmailEntry {
  label: string;
  value: string;
}

export interface AddressEntry {
  label: string;
  street: string;
  city: string;
  state?: string;
  zip: string;
  country?: string;
}

export interface Contact {
  uid: string;
  addressbook_id: string;
  etag: string;
  fn: string;
  given_name: string;
  family_name: string;
  org: string | null;
  title: string | null;
  birthday: string | null;
  note: string | null;
  has_photo: boolean;
  phones: PhoneEntry[];
  emails: EmailEntry[];
  addresses: AddressEntry[];
  created_at: string;
  updated_at: string;
}

export function contactPhotoUrl(contact: Pick<Contact, 'uid' | 'has_photo'>): string | null {
  return contact.has_photo ? `/api/contacts/${contact.uid}/photo` : null;
}

export interface AddressBook {
  id: string;
  display_name: string;
  url: string;
  contact_count: number;
  is_owner: boolean;
}

export type SmartCollection = 'all' | 'recent' | 'birthdays' | 'no-photo';

export type GroupRuleField =
  | 'family_name' | 'given_name' | 'fn' | 'org' | 'title' | 'note'
  | 'emails' | 'phones' | 'addresses.city' | 'addresses.country' | 'addresses.zip'
  | 'birthday';

export type GroupRuleOperator = 'contains' | 'equals' | 'starts_with' | 'is_empty' | 'is_not_empty';

export interface GroupRule {
  field: GroupRuleField;
  operator: GroupRuleOperator;
  value: string;
}

export interface SmartGroup {
  id: string;
  name: string;
  rules: GroupRule[];
  match: 'all' | 'any';
}

export interface ContactGroup {
  id: string;
  name: string;
  member_uids: string[];
}
