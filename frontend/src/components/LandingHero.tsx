export function LandingHero() {
  return (
    <section className="w-full flex flex-col items-center text-center py-10 gap-8 animate-fade-in-up">
      {/* Headline */}
      <div className="space-y-1 max-w-lg">
        <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground leading-tight">
          Hide the Word.&nbsp;
          <span className="text-primary">Break the Code.</span>
        </h2>
        <p className="text-sm sm:text-base text-muted-foreground leading-relaxed">
          Challenge a friend to a Wordle duel secured by zkps on{" "}
          <span className="text-foreground font-medium">Stellar</span>. Pick a secret word,
          stake XLM, and let cryptography keep it fair.
        </p>
      </div>

      {/* Feature pills */}
      <div className="flex flex-wrap justify-center gap-2.5">
        {[
          { icon: shieldIcon, label: "ZK Verified" },
          { icon: linkIcon, label: "On-Chain" },
          { icon: swordsIcon, label: "1 v 1 Duels" },
          { icon: coinIcon, label: "XLM Stakes" },
        ].map((f, i) => (
          <div
            key={i}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-border bg-card/60 text-xs sm:text-sm text-muted-foreground"
          >
            <span className="text-primary">{f.icon}</span>
            {f.label}
          </div>
        ))}
      </div>

      {/* Subtle separator */}
     
    </section>
  );
}

/* ── Inline SVG icons (16×16) ────────────────────────────── */

const shieldIcon = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    <path d="m9 12 2 2 4-4" />
  </svg>
);

const linkIcon = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
  </svg>
);

const swordsIcon = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="14.5 17.5 3 6 3 3 6 3 17.5 14.5" />
    <line x1="13" y1="19" x2="19" y2="13" />
    <line x1="16" y1="16" x2="20" y2="20" />
    <line x1="19" y1="21" x2="21" y2="19" />
    <polyline points="14.5 6.5 18 3 21 3 21 6 17.5 9.5" />
    <line x1="5" y1="14" x2="9" y2="18" />
    <line x1="7" y1="17" x2="4" y2="20" />
    <line x1="3" y1="19" x2="5" y2="21" />
  </svg>
);

const coinIcon = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="8" />
    <line x1="12" y1="8" x2="12" y2="16" />
    <line x1="8" y1="12" x2="16" y2="12" />
  </svg>
);
