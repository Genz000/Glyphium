import * as React from "react"
import * as SwitchPrimitive from "@radix-ui/react-switch"
import { cn } from "@/lib/utils"

const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitive.Root
    ref={ref}
    className={cn(
      "peer inline-flex h-4 w-[30px] shrink-0 items-center rounded-full border transition-colors",
      "data-[state=checked]:bg-accent-soft data-[state=checked]:border-accent",
      "data-[state=unchecked]:bg-transparent data-[state=unchecked]:border-line-strong",
      "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent-soft",
      className
    )}
    {...props}
  >
    <SwitchPrimitive.Thumb
      className={cn(
        "pointer-events-none block h-2.5 w-2.5 rounded-full shadow-sm transition-transform translate-x-[3px]",
        "data-[state=checked]:translate-x-[16px] data-[state=checked]:bg-accent",
        "data-[state=unchecked]:bg-dim"
      )}
    />
  </SwitchPrimitive.Root>
))
Switch.displayName = SwitchPrimitive.Root.displayName

export { Switch }
