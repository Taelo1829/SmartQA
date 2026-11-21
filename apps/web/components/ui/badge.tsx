import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-normal transition-colors',
  {
    variants: {
      variant: {
        default: 'border-brand/30 bg-brand/10 text-brand',
        secondary: 'border-violetBrand/30 bg-violetBrand/10 text-violetBrand',
        outline: 'border-border bg-transparent text-muted-foreground',
        muted: 'border-border bg-muted text-muted-foreground',
        success: 'border-success/40 bg-success/10 text-success',
        warning: 'border-severity-medium/40 bg-severity-medium/10 text-severity-medium',
        danger: 'border-severity-critical/40 bg-severity-critical/10 text-severity-critical',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
