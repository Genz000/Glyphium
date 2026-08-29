import * as React from "react"
import { cn } from "@/lib/utils"

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("border border-line rounded bg-panel", className)} {...props} />
}
export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex items-baseline gap-2 px-5 pt-4 pb-3.5 border-b border-line text-[10px] tracking-[0.18em] uppercase text-dim",
        className
      )}
      {...props}
    />
  )
}
export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-5 py-4 space-y-3.5", className)} {...props} />
}
