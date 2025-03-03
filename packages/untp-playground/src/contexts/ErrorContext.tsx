import React, { createContext, useContext, useState, ReactNode, useEffect, useCallback } from 'react';
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

  return (
    <ErrorContext.Provider value={{ error, dispatchError }}>
      {children}
      {error && (
        <div className='fixed inset-0 flex items-center justify-center bg-black bg-opacity-50 z-50'>
          <div className='bg-white rounded-lg shadow-lg p-6 max-w-lg w-full'>
            {error.length > 0 && (
              <ValidationDetailsSheet
                isOpen={isDetailsOpen}
                errors={error}
                onOpenChange={(isOpen) => setIsDetailsOpen(isOpen)}
              />
            )}
          </div>
        </div>
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
