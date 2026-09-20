import * as SliderPrimitive from "@radix-ui/react-slider";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export function Slider({
  className,
  ...props
}: ComponentProps<typeof SliderPrimitive.Root>) {
  return (
    <SliderPrimitive.Root
      className={cn("relative flex h-7 sm:h-5 w-full touch-none items-center cursor-pointer select-none", className)}
      {...props}
    >
      <SliderPrimitive.Track className="relative h-1.5 sm:h-1 w-full grow rounded-full bg-line">
        <SliderPrimitive.Range className="absolute h-full rounded-full bg-accent" />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb className="block size-4 sm:size-3.5 rounded-full border-2 border-accent bg-fg shadow-sm transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent active:scale-110" />
    </SliderPrimitive.Root>
  );
}
