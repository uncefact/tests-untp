import type { ArtefactSource } from '@/types';

export function SourceCaption({ source }: { source: ArtefactSource }) {
  const fromLinkSet = source.via === 'link-set' && source.linkSet && (
    <span data-testid='source-link-set'> · from link set {source.linkSet}</span>
  );
  if (source.kind === 'file') {
    return (
      <p className='text-xs text-gray-500 break-all'>
        Source: {source.filename}
        {fromLinkSet}
      </p>
    );
  }
  return (
    <p className='text-xs text-gray-500 break-all'>
      Source:{' '}
      <a href={source.url} target='_blank' rel='noopener noreferrer' className='underline'>
        {source.url}
      </a>
      {fromLinkSet}
    </p>
  );
}
