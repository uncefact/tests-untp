import type { ArtefactSource } from '@/types';

export function SourceCaption({ source }: { source: ArtefactSource }) {
  if (source.kind === 'file') {
    return <p className='text-xs text-gray-500'>Source: {source.filename}</p>;
  }
  return (
    <p className='text-xs text-gray-500 break-all'>
      Source:{' '}
      <a href={source.url} target='_blank' rel='noopener noreferrer' className='underline'>
        {source.url}
      </a>
    </p>
  );
}
