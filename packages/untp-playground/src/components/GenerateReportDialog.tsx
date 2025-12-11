import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { TooltipWrapper } from '@/components/TooltipWrapper';


export const GenerateReportDialog = () => {
  const [open, setOpen] = useState(false);


  const handleGenerate = () => {
    // generateReport('Default Implementation');
    setOpen(false);
  };

  return (
    <div>
      <TooltipWrapper content='Generate a new report to enable download options'>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button
              className='w-full'
              onClick={() => setOpen(true)}
              data-testid='generate-report-button'
            >
              { 'Generate Report' }
            </Button>
          </DialogTrigger>
          <DialogContent className='sm:max-w-[425px]'>
            <DialogHeader>
              <DialogTitle>Generate Test Report</DialogTitle>
              <DialogDescription>
                This will generate a new test report. Any existing report data will be overwritten.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant='outline' onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleGenerate}>Generate</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </TooltipWrapper>
    </div>
  );
};
