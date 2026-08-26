"use client"

import * as React from "react"
import { Separator as SeparatorPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

function Separator({
  className,
  orientation = "horizontal",
  decorative = true,
  ...props
}: React.ComponentProps<typeof SeparatorPrimitive.Root>) {
  return (
    <SeparatorPrimitive.Root
      data-slot="separator"
      decorative={decorative}
      orientation={orientation}
      className={cn(
        // No-Line Rule override: a separator is a surface-container-high
        // background band, never a 1px border/line.
        "shrink-0 rounded-full bg-surface-container-high data-horizontal:h-2 data-horizontal:w-full data-vertical:h-full data-vertical:w-2",
        className
      )}
      {...props}
    />
  )
}

export { Separator }
