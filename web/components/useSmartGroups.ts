'use client';

import { useState, useCallback, useEffect } from 'react';
import type { SmartGroup, Contact, GroupRule } from '@/types/contact';

const STORAGE_KEY = 'frigg:smart-groups';

function loadGroups(): SmartGroup[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as SmartGroup[]) : [];
  } catch {
    return [];
  }
}

function saveGroups(groups: SmartGroup[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(groups));
}

export function useSmartGroups() {
  const [groups, setGroups] = useState<SmartGroup[]>([]);

  useEffect(() => {
    setGroups(loadGroups());
  }, []);

  const addGroup = useCallback((group: SmartGroup) => {
    setGroups((prev) => {
      const next = [...prev, group];
      saveGroups(next);
      return next;
    });
  }, []);

  const updateGroup = useCallback((group: SmartGroup) => {
    setGroups((prev) => {
      const next = prev.map((g) => (g.id === group.id ? group : g));
      saveGroups(next);
      return next;
    });
  }, []);

  const deleteGroup = useCallback((id: string) => {
    setGroups((prev) => {
      const next = prev.filter((g) => g.id !== id);
      saveGroups(next);
      return next;
    });
  }, []);

  return { groups, addGroup, updateGroup, deleteGroup };
}

function getField(contact: Contact, field: GroupRule['field']): string {
  switch (field) {
    case 'family_name': return contact.family_name ?? '';
    case 'given_name': return contact.given_name ?? '';
    case 'fn': return contact.fn ?? '';
    case 'org': return contact.org ?? '';
    case 'title': return contact.title ?? '';
    case 'note': return contact.note ?? '';
    case 'birthday': return contact.birthday ?? '';
    case 'emails': return contact.emails.map((e) => e.value).join(' ');
    case 'phones': return contact.phones.map((p) => p.value).join(' ');
    case 'addresses.city': return contact.addresses.map((a) => a.city).join(' ');
    case 'addresses.country': return contact.addresses.map((a) => a.country ?? '').join(' ');
    case 'addresses.zip': return contact.addresses.map((a) => a.zip).join(' ');
    default: return '';
  }
}

function applyRule(contact: Contact, rule: GroupRule): boolean {
  const raw = getField(contact, rule.field);
  const val = raw.toLowerCase();
  const q = rule.value.toLowerCase();

  switch (rule.operator) {
    case 'contains': return val.includes(q);
    case 'equals': return val === q;
    case 'starts_with': return val.startsWith(q);
    case 'is_empty': return raw.trim() === '';
    case 'is_not_empty': return raw.trim() !== '';
    default: return false;
  }
}

export function applySmartGroup(contacts: Contact[], group: SmartGroup): Contact[] {
  if (group.rules.length === 0) return contacts;
  return contacts.filter((c) => {
    const results = group.rules.map((r) => applyRule(c, r));
    return group.match === 'all' ? results.every(Boolean) : results.some(Boolean);
  });
}
