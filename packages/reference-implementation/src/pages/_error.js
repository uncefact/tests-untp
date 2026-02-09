// TODO: Remove after investigating useContext bug during static prerendering
// See: https://github.com/vercel/next.js/issues/82366

function Error({ statusCode }) {
  return (
    <div style={{ padding: '20px', textAlign: 'center' }}>
      <h1>{statusCode || 'Error'}</h1>
      <p>{statusCode === 404 ? 'Page not found' : 'An error occurred'}</p>
    </div>
  );
}

Error.getInitialProps = ({ res, err }) => {
  const statusCode = res ? res.statusCode : err ? err.statusCode : 404;
  return { statusCode };
};

export default Error;
