import { NextPage } from 'next';

interface ErrorProps {
  statusCode?: number;
}

const Error: NextPage<ErrorProps> = ({ statusCode }) => {
  return (
    <div style={{ textAlign: 'center', padding: '50px' }}>
      <h1>{statusCode ? `Error ${statusCode}` : 'An error occurred'}</h1>
      <p>
        {statusCode === 404
          ? 'The page you are looking for does not exist.'
          : 'An unexpected error occurred.'}
      </p>
    </div>
  );
};

Error.getInitialProps = ({ res, err }) => {
  const statusCode = res ? res.statusCode : err ? err.statusCode : 404;
  return { statusCode };
};

export default Error;
