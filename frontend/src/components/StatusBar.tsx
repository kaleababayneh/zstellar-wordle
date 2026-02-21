interface StatusBarProps {
  messages: string[];
}

export function StatusBar({ messages }: StatusBarProps) {
  if (messages.length === 0) return null;

  return (
    <div className="w-full max-w-lg mx-auto mt-4 border-t border-border pt-3 text-xs font-mono space-y-0.5 max-h-32 overflow-y-auto">
      {messages.map((msg, i) => (
        <div key={i} className="text-muted-foreground/70">{msg}</div>
      ))}
    </div>
  );
}
