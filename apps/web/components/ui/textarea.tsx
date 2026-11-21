import * as React from 'react';
import { cn } from '@/lib/utils';

const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      'flex min-h-[76px] w-full rounded-md border border-input bg-background/60 px-3 py-2 text-[13px] text-foreground shadow-none transition-colors',
      'placeholder:text-muted-foreground/70',
      'focus-visible:border-brand/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand/40',
      'disabled:cursor-not-allowed disabled:opacity-50',
      className,
    )}
    {...props}
  />
));
Textarea.displayName = 'Textarea';

export { Textarea };
