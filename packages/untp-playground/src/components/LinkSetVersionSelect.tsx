'use client';

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { LINK_SET_SPEC_VERSIONS, type LinkSetSpecVersion } from '../../constants';

/**
 * The Link Sets tab's spec version selector (#988). Link sets only: credentials and schemes keep
 * their detected versions. The description says what the selection applies to, because the
 * natural assumption (it re-checks what is already loaded) is not what happens.
 */
export function LinkSetVersionSelect({
  value,
  onChange,
}: {
  value: LinkSetSpecVersion;
  onChange: (version: LinkSetSpecVersion) => void;
}) {
  return (
    <div className='flex flex-wrap items-center gap-x-3 gap-y-1 pb-3' data-testid='linkset-version-select'>
      <label htmlFor='linkset-spec-version' className='text-sm font-medium'>
        Validate link sets against UNTP
      </label>
      <Select value={value} onValueChange={(next) => onChange(next as LinkSetSpecVersion)}>
        <SelectTrigger id='linkset-spec-version' className='h-8 w-28' aria-label='UNTP spec version for link sets'>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {LINK_SET_SPEC_VERSIONS.map((version) => (
            <SelectItem key={version} value={version}>
              v{version}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className='basis-full text-xs text-muted-foreground'>
        Applies to link sets you add next. To check an existing link set with another version, resolve or upload it
        again.
      </p>
    </div>
  );
}
