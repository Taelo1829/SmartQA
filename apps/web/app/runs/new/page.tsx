import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { RunForm } from '@/components/run-form';
import { Shell } from '@/components/shell';
import { Button } from '@/components/ui/button';

export const metadata: Metadata = {
  title: 'New test',
};

export default function NewRunPage() {
  return (
    <Shell
      title="New test"
      subtitle="Configure an autonomous run. Budgets and safety guardrails are enforced by the agent."
      actions={
        <Button asChild variant="outline" size="sm">
          <Link href="/runs">
            <ArrowLeft className="h-3.5 w-3.5" />
            All runs
          </Link>
        </Button>
      }
    >
      <RunForm />
    </Shell>
  );
}
