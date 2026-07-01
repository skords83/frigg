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

export interface ContactRow {
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
  raw_vcard: string;
  created_at: Date;
  updated_at: Date;
}

export interface AddressBookRow {
  id: string;
  display_name: string;
  url: string;
  ctag: string | null;
  sync_token: string | null;
  updated_at: Date;
}
