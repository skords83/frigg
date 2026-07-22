'use client';

import { useState, useCallback, useEffect } from 'react';
import type { ContactGroup } from '@/types/contact';

export function useGroups() {
  const [groups, setGroups] = useState<ContactGroup[]>([]);

  const refresh = useCallback(async () => {
    const res = await fetch('/api/groups');
    if (!res.ok) return;
    setGroups(await res.json());
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const createGroup = useCallback(async (name: string) => {
    const res = await fetch('/api/groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) return null;
    const group: ContactGroup = await res.json();
    setGroups((prev) => [...prev, group]);
    return group;
  }, []);

  const renameGroup = useCallback(async (id: string, name: string) => {
    const res = await fetch(`/api/groups/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) return;
    setGroups((prev) => prev.map((g) => (g.id === id ? { ...g, name } : g)));
  }, []);

  const deleteGroup = useCallback(async (id: string) => {
    const res = await fetch(`/api/groups/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!res.ok) return;
    setGroups((prev) => prev.filter((g) => g.id !== id));
  }, []);

  const addMember = useCallback(async (groupId: string, contactUid: string) => {
    const res = await fetch(`/api/groups/${encodeURIComponent(groupId)}/members`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contact_uid: contactUid }),
    });
    if (!res.ok) return;
    setGroups((prev) => prev.map((g) => (
      g.id === groupId && !g.member_uids.includes(contactUid)
        ? { ...g, member_uids: [...g.member_uids, contactUid] }
        : g
    )));
  }, []);

  const removeMember = useCallback(async (groupId: string, contactUid: string) => {
    const res = await fetch(`/api/groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(contactUid)}`, {
      method: 'DELETE',
    });
    if (!res.ok) return;
    setGroups((prev) => prev.map((g) => (
      g.id === groupId ? { ...g, member_uids: g.member_uids.filter((u) => u !== contactUid) } : g
    )));
  }, []);

  return { groups, createGroup, renameGroup, deleteGroup, addMember, removeMember };
}
