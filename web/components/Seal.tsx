interface SealProps {
  initials: string;
  size?: 'sm' | 'lg';
  photoUrl?: string | null;
}

function OrgIcon({ isLg }: { isLg: boolean }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={isLg ? 'w-10 h-10' : 'w-[13px] h-[13px]'}
    >
      <path d="M3 18V8.5L10 4l7 4.5V18H3z" />
      <path d="M8 18v-5h4v5" />
    </svg>
  );
}

export function Seal({ initials, size = 'sm', photoUrl }: SealProps) {
  const isLg = size === 'lg';

  if (photoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={photoUrl}
        alt={initials}
        className={`rounded-full object-cover flex-shrink-0 ${isLg ? 'w-24 h-24' : 'w-8 h-8'}`}
      />
    );
  }

  return (
    <div
      aria-hidden="true"
      className={`seal rounded-full flex items-center justify-center flex-shrink-0 font-fraunces text-accent
        ${isLg ? 'seal-lg w-24 h-24 text-[34px] font-medium' : 'w-8 h-8 text-[12px]'}`}
    >
      {initials ? initials : <OrgIcon isLg={isLg} />}
    </div>
  );
}

export function getInitials(givenName: string, familyName: string): string {
  const g = givenName.trim()[0] ?? '';
  const f = familyName.trim()[0] ?? '';
  return (g + f).toUpperCase();
}
