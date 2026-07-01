interface SealProps {
  initials: string;
  size?: 'sm' | 'lg';
  photoUrl?: string | null;
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
        ${isLg ? 'seal-lg w-24 h-24 text-[34px] font-medium mb-4' : 'w-8 h-8 text-[12px]'}`}
    >
      {initials}
    </div>
  );
}

export function getInitials(givenName: string, familyName: string): string {
  const g = givenName.trim()[0] ?? '';
  const f = familyName.trim()[0] ?? '';
  return (g + f).toUpperCase() || '?';
}
