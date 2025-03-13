import React, { createContext, useContext, useState, ReactNode, useEffect, useCallback, useMemo } from 'react';
import ValidationDetailsSheet from '@/components/ValidationDetailsSheet';
import { ValidationError } from '@/types';

interface ErrorContextType {
  errors: ValidationError[] | null;
  dispatchError: (error: ValidationError[]) => void;
  setIsDetailsOpen: (isOpen: boolean) => void;
  setErrors: (error: ValidationError[]) => void;
}

const ErrorContext = createContext<ErrorContextType | undefined>(undefined);

export const ErrorProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [errors, setErrors] = useState<ValidationError[]>([]);

  const [isDetailsOpen, setIsDetailsOpen] = useState(false);

  const dispatchError = useCallback((error: ValidationError[]) => {
    setIsDetailsOpen(true);
    setErrors((prevErrors) => [...prevErrors, ...error]);
  }, []);

  const contextValue = useMemo(
    () => ({ errors, dispatchError, setIsDetailsOpen, setErrors }),
    [errors, dispatchError, setIsDetailsOpen, setErrors],
  );

  return (
    <ErrorContext.Provider value={contextValue}>
      {children}
      {errors && (
        <>
          {errors.length > 0 && (
            <ValidationDetailsSheet
              isOpen={isDetailsOpen}
              errors={errors}
              onOpenChange={(isOpen) => setIsDetailsOpen(isOpen)}
            />
          )}
        </>
      )}
    </ErrorContext.Provider>
  );
};

export const useError = () => {
  const context = useContext(ErrorContext);
  if (!context) {
    throw new Error('useError must be used within an ErrorProvider');
  }
  return context;
};
