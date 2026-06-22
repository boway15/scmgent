import * as React from 'react';
import { Input, type InputProps } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export interface AiInputProps extends InputProps {
  showSparkle?: boolean;
}

const AiInput = React.forwardRef<HTMLInputElement, AiInputProps>(
  ({ className, showSparkle = true, ...props }, ref) => (
    <div className="relative">
      <Input ref={ref} variant="ai" className={cn(showSparkle && 'pr-8', className)} {...props} />
      {showSparkle && (
        <span
          className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm"
          aria-hidden
        >
          ✨
        </span>
      )}
    </div>
  ),
);
AiInput.displayName = 'AiInput';

export { AiInput };
