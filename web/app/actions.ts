'use server';

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';

const apiUrl = process.env.API_URL || 'http://localhost:3001';

export async function syncContacts(): Promise<{ ok: boolean }> {
  try {
    const cookieHeader = (await cookies()).toString();
    const res = await fetch(`${apiUrl}/api/sync`, {
      method: 'POST',
      headers: { Cookie: cookieHeader },
    });
    if (!res.ok) return { ok: false };
    revalidatePath('/');
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

export async function invalidateContacts(): Promise<void> {
  revalidatePath('/');
}
