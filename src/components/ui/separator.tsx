import { cn } from "@/lib/utils";

export function Separator({ className, vertical }: { className?: string; vertical?: boolean }) {
  return (
    <div
      role="separator"
      className={cn(vertical ? "h-full w-px bg-line" : "h-px w-full bg-line", className)}
    />
  );
}
