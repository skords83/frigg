'use client';

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

interface IndexRailProps {
  available: Set<string>;
  onSelect: (letter: string) => void;
}

export function IndexRail({ available, onSelect }: IndexRailProps) {
  return (
    <nav aria-label="Alphabetische Schnellnavigation" className="w-[22px] flex flex-col items-center justify-center py-2">
      {LETTERS.map((letter) => {
        const has = available.has(letter);
        return (
          <button
            key={letter}
            onClick={() => has && onSelect(letter)}
            aria-label={`Springe zu ${letter}`}
            disabled={!has}
            className={`font-mono text-[9px] w-full h-[14px] flex items-center justify-center rounded-[3px] transition-colors
              ${has
                ? 'text-muted hover:bg-surface-raised hover:text-accent cursor-pointer'
                : 'text-muted opacity-20 cursor-default'
              }`}
          >
            {letter}
          </button>
        );
      })}
    </nav>
  );
}
