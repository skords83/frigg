import type { Contact } from '@/types/contact';

export interface DuplicatePair {
  a: Contact;
  b: Contact;
  score: number;
  reasons: string[];
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

function normalizePhone(p: string): string {
  return p.replace(/[\s\-().+]/g, '');
}

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

function stringSimilarity(a: string, b: string): number {
  if (!a && !b) return 1;
  if (!a || !b) return 0;
  const maxLen = Math.max(a.length, b.length);
  return 1 - levenshtein(a, b) / maxLen;
}

export function findDuplicates(contacts: Contact[]): DuplicatePair[] {
  const pairs: DuplicatePair[] = [];

  for (let i = 0; i < contacts.length; i++) {
    for (let j = i + 1; j < contacts.length; j++) {
      const a = contacts[i];
      const b = contacts[j];
      const reasons: string[] = [];
      let score = 0;

      // Exact email match (strong signal)
      const aEmails = new Set(a.emails.map((e) => normalize(e.value)));
      const bEmails = new Set(b.emails.map((e) => normalize(e.value)));
      const sharedEmails = [...aEmails].filter((e) => e && bEmails.has(e));
      if (sharedEmails.length > 0) {
        score += 0.6;
        reasons.push(`Gleiche E-Mail: ${sharedEmails[0]}`);
      }

      // Exact phone match (strong signal)
      const aPhones = new Set(a.phones.map((p) => normalizePhone(p.value)));
      const bPhones = new Set(b.phones.map((p) => normalizePhone(p.value)));
      const sharedPhones = [...aPhones].filter((p) => p.length >= 7 && bPhones.has(p));
      if (sharedPhones.length > 0) {
        score += 0.5;
        reasons.push(`Gleiche Telefonnr.: ${sharedPhones[0]}`);
      }

      // Name similarity
      const aName = normalize(`${a.given_name ?? ''} ${a.family_name ?? ''}`);
      const bName = normalize(`${b.given_name ?? ''} ${b.family_name ?? ''}`);
      const nameSim = stringSimilarity(aName, bName);
      if (nameSim >= 0.9) {
        score += 0.5;
        reasons.push('Sehr ähnlicher Name');
      } else if (nameSim >= 0.75) {
        score += 0.25;
        reasons.push('Ähnlicher Name');
      }

      // Same org + similar name
      if (a.org && b.org && normalize(a.org) === normalize(b.org) && nameSim >= 0.6) {
        score += 0.15;
        reasons.push(`Gleiche Firma: ${a.org}`);
      }

      if (score >= 0.5 && reasons.length > 0) {
        pairs.push({ a, b, score: Math.min(score, 1), reasons });
      }
    }
  }

  return pairs.sort((a, b) => b.score - a.score);
}
