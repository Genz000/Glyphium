import * as React from "react"
import * as ToggleGroupPrimitive from "@radix-ui/react-toggle-group"
import { cn } from "@/lib/utils"

const ToggleGroup = React.forwardRef<
  React.ElementRef<typeof ToggleGroupPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ToggleGroupPrimitive.Root>
>(({ className, ...props }, ref) => (
  <ToggleGroupPrimitive.Root
    ref={ref}
    className={cn("flex rounded border border-line overflow-hidden", className)}
    {...props}
  />
))
ToggleGroup.displayName = "ToggleGroup"

const ToggleGroupItem = React.forwardRef<
  React.ElementRef<typeof ToggleGroupPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof ToggleGroupPrimitive.Item>
>(({ className, children, ...props }, ref) => (
  <ToggleGroupPrimitive.Item
    ref={ref}
    className={cn(
      "flex-1 bg-panel-2 border-r border-line last:border-r-0 px-2 py-1.5 text-[10.5px] tracking-wide text-dim",
      "hover:text-ink transition-colors",
      "data-[state=on]:bg-accent-soft data-[state=on]:text-accent",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft focus-visible:z-10",
      className
    )}
    {...props}
  >
    {children}
  </ToggleGroupPrimitive.Item>
))
ToggleGroupItem.displayName = "ToggleGroupItem"

export { ToggleGroup, ToggleGroupItem }
