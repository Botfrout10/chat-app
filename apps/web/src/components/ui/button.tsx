import * as React from "react";

export function Button({
  variant = "default",
  size = "default",
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "default" | "ghost" | "outline" | "secondary"; size?: "default" | "sm" | "icon" }) {
  const base =
    "inline-flex items-center justify-center rounded-[var(--radius-sm)] font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)]";
  const variants: Record<string, string> = {
    default:
      "bg-[var(--primary)] text-[var(--primary-foreground)] hover:bg-[var(--primary-hover)] shadow-[var(--shadow-soft)]",
    ghost:
      "text-[var(--foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]",
    outline:
      "border border-[var(--border)] bg-[var(--card)] text-[var(--foreground)] hover:bg-[var(--muted)]",
    secondary:
      "bg-[var(--secondary)] text-[var(--secondary-foreground)] hover:opacity-90",
  };
  const sizes: Record<string, string> = {
    default: "h-9 px-4 py-2 text-sm",
    sm: "h-7 px-3 text-xs",
    icon: "h-9 w-9",
  };
  return <button className={`${base} ${variants[variant]} ${sizes[size]} ${className}`} {...props} />;
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`flex h-9 w-full rounded-[var(--radius-sm)] border border-[var(--input-border)] bg-[var(--input)] px-3 py-2 text-sm text-[var(--foreground)] placeholder:text-[var(--muted-foreground)]/60 focus:outline-none focus:ring-2 focus:ring-[var(--ring)] focus:border-[var(--primary)] disabled:opacity-50 ${props.className ?? ""}`}
    />
  );
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={`flex w-full rounded-[var(--radius-sm)] border border-[var(--input-border)] bg-[var(--input)] px-3 py-2 text-sm text-[var(--foreground)] placeholder:text-[var(--muted-foreground)]/60 focus:outline-none focus:ring-2 focus:ring-[var(--ring)] focus:border-[var(--primary)] ${props.className ?? ""}`}
    />
  );
}

export function Badge({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full bg-[var(--accent-100)] text-[var(--accent-700)] dark:bg-[var(--sidebar-muted)] dark:text-[var(--accent-300)] border border-[var(--border)] px-2.5 py-0.5 text-xs font-medium ${className}`}
    >
      {children}
    </span>
  );
}

export function Card({ children, className = "", ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`rounded-[var(--radius)] border border-[var(--border)] bg-[var(--card)] text-[var(--card-foreground)] shadow-[var(--shadow-soft)] ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}
