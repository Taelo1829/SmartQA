import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const alertVariants = cva(
  'relative w-full rounded-lg border px-3.5 py-3 text-[12px] [&>svg]:absolute [&>svg]:left-3.5 [&>svg]:top-3.5 [&>svg]:size-4 [&>svg~*]:pl-6',
  {
    variants: {
      variant: {
        default: 'border-border bg-panel text-foreground',
        info: 'border-brand/30 bg-brand/5 text-foreground [&>svg]:text-brand',
        warning: 'border-severity-medium/40 bg-severity-medium/5 text-foreground [&>svg]:text-severity-medium',
        success: 'border-success/40 bg-success/5 text-foreground [&>svg]:text-success',
        destructive: 'border-severity-critical/40 bg-severity-critical/5 text-foreground [&>svg]:text-severity-critical',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

const Alert = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof alertVariants>
>(({ className, variant, ...props }, ref) => (
  <div ref={ref} role="alert" className={cn(alertVariants({ variant }), className)} {...props} />
));
Alert.displayName = 'Alert';

const AlertTitle = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h5
      ref={ref}
      className={cn('mb-0.5 text-[12px] font-semibold leading-snug tracking-tight', className)}
      {...props}
    />
  ),
);
AlertTitle.displayName = 'AlertTitle';

const AlertDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn('text-[12px] leading-relaxed text-muted-foreground', className)} {...props} />
));
AlertDescription.displayName = 'AlertDescription';

export { Alert, AlertTitle, AlertDescription };
