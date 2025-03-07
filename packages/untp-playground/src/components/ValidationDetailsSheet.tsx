'use client';

import React from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { ErrorDialog } from './ErrorDialog';

interface ValidationDetailsSheetProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  errors: any[];
}

const ValidationDetailsSheet: React.FC<ValidationDetailsSheetProps> = ({ isOpen, onOpenChange, errors }) => {
  return (
    <Sheet open={isOpen} onOpenChange={onOpenChange}>
      <SheetContent className='sm:max-w-[600px]'>
        <SheetHeader>
          <SheetTitle>Validation Details</SheetTitle>
        </SheetHeader>
        <div className='mt-4 overflow-y-auto max-h-[calc(100vh-8rem)]'>
          {errors && errors.length > 0 ? (
            <>
              <ErrorDialog errors={errors} className='w-full max-w-none' />
            </>
          ) : (
            <div className='text-yellow-600'>
              <p>⚠️ Additional properties found in credential</p>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
};

export default ValidationDetailsSheet;
