interface StatusBarProps {
  messages: string[];
}

export function StatusBar({ messages }: StatusBarProps) {
  if (messages.length === 0) return null;

  return (
    <div className="w-full max-w-md mx-auto mt-4 bg-card border border-border rounded-lg p-3 text-sm text-card-foreground font-mono space-y-1 max-h-40 overflow-y-auto">
      {messages.map((msg, i) => (
        <div key={i} className="text-muted-foreground">{msg}</div>
      ))}
    </div>
  );
}
