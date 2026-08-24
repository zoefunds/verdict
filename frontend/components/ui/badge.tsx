import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-sm border px-2 py-0.5 font-mono text-label-md uppercase tracking-wide",
  {
    variants: {
      variant: {
        neutral: "border-outline-variant bg-outline-variant/10 text-on-surface-variant",
        primary: "border-primary/40 bg-primary/10 text-primary",
        secondary: "border-secondary/40 bg-secondary/10 text-secondary",
        tertiary: "border-tertiary/40 bg-tertiary/10 text-tertiary",
        error: "border-error/40 bg-error/10 text-error",
        appeal: "border-appeal/40 bg-appeal/10 text-appeal",
      },
    },
    defaultVariants: { variant: "neutral" },
  },
);

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
