import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-sm font-medium transition-[opacity,transform,background-color] duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-3.5",
  {
    variants: {
      variant: {
        default: "bg-accent text-accent-fg hover:opacity-90 active:scale-[0.98]",
        ghost: "text-fg hover:bg-elevated",
        outline: "border border-line bg-transparent text-fg hover:bg-elevated",
        subtle: "bg-panel text-fg hover:bg-elevated",
        danger: "bg-danger/20 text-danger hover:bg-danger/30",
      },
      size: {
        default: "h-9 px-3 text-sm",
        sm: "h-7 px-2 text-micro",
        lg: "h-11 px-4 text-sm",
        icon: "size-9",
        "icon-sm": "size-7",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: ComponentProps<"button"> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "button";
  return <Comp className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
