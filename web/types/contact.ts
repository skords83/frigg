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
  photo_data_uri: string | null;
  phones: PhoneEntry[];
  emails: EmailEntry[];
  addresses: AddressEntry[];
  created_at: string;
  updated_at: string;
}

export interface AddressBook {
  id: string;
  display_name: string;
  url: string;
  contact_count: number;
}

export type SmartCollection = 'all' | 'recent' | 'birthdays' | 'no-photo';
