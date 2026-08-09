import React from "react";

// ---------------------------------------------------------------------------
// Tiny toast store (no external dependency)
// ---------------------------------------------------------------------------
export type Toast = { id: number; kind: "ok" | "err"; text: string };

let pushToast: ((t: Toast) => void) | null = null;

export function toast(kind: "ok" | "err", text: string) {
  pushToast?.({ id: Date.now() + Math.random(), kind, text });
}

export function ToastHost() {
  const [items, setItems] = React.useState<Toast[]>([]);
  React.useEffect(() => {
    pushToast = (t) => {
      setItems((prev) => [...prev, t]);
      setTimeout(() => setItems((prev) => prev.filter((x) => x.id !== t.id)), 4000);
    };
    return () => {
      pushToast = null;
    };
  }, []);
  return (
    <>
      {items.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          {t.text}
        </div>
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// Small building blocks
// ---------------------------------------------------------------------------
export function Card({
  children,
  className = "",
  style,
}: {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div className={`card ${className}`} style={style}>
      {children}
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
      {hint ? <div className="hint">{hint}</div> : null}
    </div>
  );
}

export function Badge({ tone, children }: { tone: string; children: React.ReactNode }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

export function Spinner() {
  return <span className="muted">Loading…</span>;
}

export function ErrorBox({ message }: { message: string }) {
  return <div className="card" style={{ color: "var(--red)" }}>{message}</div>;
}
