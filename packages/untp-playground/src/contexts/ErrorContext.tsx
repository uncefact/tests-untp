import React, { createContext, useContext, useState, ReactNode, useEffect, useCallback, useMemo } from 'react';
import ValidationDetailsSheet from '@/components/ValidationDetailsSheet';
import { ValidationError } from '@/types';

interface ErrorContextType {
  error: ValidationError[] | null;
  dispatchError: (error: ValidationError[]) => void;
}

const ErrorContext = createContext<ErrorContextType | undefined>(undefined);

export const ErrorProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [error, setError] = useState<ValidationError[] | null>(null);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);

  const dispatchError = useCallback((error: ValidationError[]) => {
    setIsDetailsOpen(true);
    setError(error);
  }, []);

  useEffect(() => {
    if (!isDetailsOpen) {
      setError(null);
    }
  }, [isDetailsOpen]);

  const contextValue = useMemo(() => ({ error, dispatchError }), [error, dispatchError]);

  return (
    <ErrorContext.Provider value={contextValue}>
      {children}
      {error && (
        <>
          {error.length > 0 && (
            <ValidationDetailsSheet
              isOpen={isDetailsOpen}
              errors={error}
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
