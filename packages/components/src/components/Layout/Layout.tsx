import React from 'react';
import { ErrorBoundary } from 'react-error-boundary';
import { Container, Box, Typography } from '@mui/material';
import { Done as DoneIcon, CancelOutlined as CancelOutlinedIcon } from '@mui/icons-material';

// Enum defining possible statuses for the layout
export enum LayoutStatus {
  success = 'success',
  error = 'error',
}

/**
 * FallbackErrorContent Component returns a Box component containing the MessageText component with an error status
 */
export const FallbackErrorContent = ({ errorMessage }: { errorMessage: string }) => {
  return (
    <Box
      sx={{
        alignItems: 'center',
        justifyContent: 'center',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <MessageText status={LayoutStatus.error} text={errorMessage} />
    </Box>
  );
};

/**
 * MessageText Component returns a Box component containing an icon based on the status
 * and a Typography component with the provided text
 */
export function MessageText({ status, text }: { status?: LayoutStatus; text: string }) {
  return (
    <Box
      sx={{
        display: 'flex',
        justifyContent: 'center',
      }}
    >
      {status === LayoutStatus.error && (
        <>
          <CancelOutlinedIcon color='error' sx={{ marginRight: '10px' }} />
        </>
      )}
      {status === LayoutStatus.success && (
        <>
          <DoneIcon color='success' sx={{ marginRight: '10px' }} />
        </>
      )}
      <Typography sx={{ marginBottom: '50px' }}>{text}</Typography>
    </Box>
  );
}

/**
 * Layout component is used to display the header and navigation to other pages
 */
export const Layout = ({
  children,
  errorMessage = 'Something went wrong! Please retry again',
}: {
  children: React.ReactNode;
  errorMessage?: string;
}) => {
  return (
    /**
     * The ErrorBoundary component is used to catch errors anywhere in the component tree
     * and provide a fallback UI in case of an error. In this case, the FallbackComponent is specified
     * as an inline arrow function that renders the FallbackErrorContent component with the provided errorMessage.
     */
    <ErrorBoundary FallbackComponent={() => <FallbackErrorContent errorMessage={errorMessage} />}>
      <Container
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          mt: '64px',
          mb: '24px',
        }}
      >
        {children}
      </Container>
    </ErrorBoundary>
  );
};
