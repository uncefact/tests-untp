import { getApiDocs } from '@/lib/swagger/swagger';
import ReactSwagger from './react-swagger';

export const metadata = {
  title: 'API Documentation - UNTP Reference Implementation',
  description: 'OpenAPI documentation for the UNTP Reference Implementation API',
};

export default async function IndexPage() {
  const spec = await getApiDocs();
  return (
    <section className='container'>
      <ReactSwagger spec={spec} />
    </section>
  );
}
