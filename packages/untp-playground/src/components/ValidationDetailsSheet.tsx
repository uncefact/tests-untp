'use client';

import React from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { ErrorDialog } from './ErrorDialog';
import type { ArtefactFailureFamily, ArtefactStepFailure } from '@/lib/artefactFailure';

interface ValidationDetailsSheetProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  errors: any[];
  failure?: ArtefactStepFailure;
  family?: ArtefactFailureFamily;
  trigger?: React.ReactNode;
}

const ValidationDetailsSheet: React.FC<ValidationDetailsSheetProps> = ({
  isOpen,
  onOpenChange,
  errors,
  failure,
  family = 'credential',
  trigger,
}) => {
  return (
    <Sheet open={isOpen} onOpenChange={onOpenChange}>
      {trigger && <SheetTrigger asChild>{trigger}</SheetTrigger>}
      <SheetContent className='sm:max-w-[600px]'>
        <SheetHeader>
          <SheetTitle>Validation Details</SheetTitle>
        </SheetHeader>
        <div className='mt-4 overflow-y-auto max-h-[calc(100vh-8rem)]'>
          <ErrorDialog errors={errors} failure={failure} family={family} className='w-full max-w-none' />
        </div>
      </SheetContent>
    </Sheet>
  );
};

export default ValidationDetailsSheet;
