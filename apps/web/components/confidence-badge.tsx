import type { Confidence } from '@smartqa/shared/types';
import { CONFIDENCE_BADGE, CONFIDENCE_LABEL } from '@/lib/format';
import { cn } from '@/lib/utils';

export function ConfidenceBadge({
  confidence,
  className,
}: {
  confidence: Confidence;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium leading-normal',
        CONFIDENCE_BADGE[confidence],
        className,
      )}
      title={`Confidence: ${CONFIDENCE_LABEL[confidence]}`}
    >
      {CONFIDENCE_LABEL[confidence]}
    </span>
  );
}
