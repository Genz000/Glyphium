import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded text-[11px] tracking-wide uppercase font-medium transition-colors duration-150 disabled:pointer-events-none disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2 [&_svg]:size-3.5 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-accent text-bg font-bold hover:bg-[#B4B3FF] border border-accent hover:border-[#B4B3FF]",
        outline:
          "bg-panel-2 border border-line-strong text-ink hover:border-accent hover:text-accent",
        ghost: "text-dim hover:text-ink hover:bg-panel-2 normal-case tracking-normal",
        destructive: "bg-panel-2 border border-danger/40 text-danger hover:bg-danger/10",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-7 px-3 text-[10px]",
        icon: "h-7 w-7 shrink-0 p-0",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
