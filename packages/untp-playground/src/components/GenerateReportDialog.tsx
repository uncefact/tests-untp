import { TooltipWrapper } from '@/components/TooltipWrapper';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useTestReport } from '@/contexts/TestReportContext';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';

export function GenerateReportDialog() {
  const { canGenerateReport, generateReport, report } = useTestReport();
  const [open, setOpen] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [implementationName, setImplementationName] = useState('');

  const handleGenerate = async () => {
    setIsGenerating(true);
    try {
      await generateReport(implementationName);
      setOpen(false);
    } finally {
      setIsGenerating(false);
    }
  };

  const isValid = implementationName.trim().length > 0;

  const tooltipContent =
    report !== null
      ? 'A report has already been generated'
      : !canGenerateReport
        ? 'Upload and validate a credential to generate a conformance report'
        : 'Generate UNTP conformance report';

  return (
    <>
      <TooltipWrapper content={tooltipContent} dataTestId='generate-report-button'>
        <Button
          disabled={!canGenerateReport || report !== null}
          variant='default'
          onClick={() => setOpen(true)}
          data-testid='generate-report-button'
        >
          Generate Report
        </Button>
      </TooltipWrapper>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className='sm:max-w-[425px]'>
          <DialogHeader>
            <DialogTitle>Generate Test Report</DialogTitle>
            <DialogDescription>
              Add your implementation details to generate a test report. This information will be included in the
              report.
            </DialogDescription>
          </DialogHeader>
          <div className='grid gap-2 py-4'>
            <Label htmlFor='name'>Implementation Name</Label>
            <Input
              id='name'
              value={implementationName}
              onChange={(e) => setImplementationName(e.target.value)}
              placeholder='Enter the name of your implementation'
              data-testid='implementation-name-input'
            />
          </div>
          <DialogFooter>
            <Button variant='outline' onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <TooltipWrapper
              content='Enter implementation details to generate a conformance report'
              dataTestId='dialog-generate-report-button'
              disabled={isValid}
            >
              <Button
                onClick={handleGenerate}
                disabled={!isValid || isGenerating}
                data-testid='confirm-generate-dialog-button'
              >
                {isGenerating ? (
                  <>
                    <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                    Generating...
                  </>
                ) : (
                  'Generate'
                )}
              </Button>
            </TooltipWrapper>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
