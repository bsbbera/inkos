import { clsx, type ClassValue } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

/* The type lock's names are font sizes. Without saying so, tailwind-merge
   reads `text-cap` as a colour and drops it beside `text-muted-foreground`. */
export const TYPE_STEPS = ["micro", "cap", "small", "body", "lead", "h3", "h2", "h1", "d1", "d2", "d3"] as const

const twMerge = extendTailwindMerge({ extend: { theme: { text: [...TYPE_STEPS] } } })

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
