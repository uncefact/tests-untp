import {
  libraryReadFailureSchema,
  LibraryRecordSelectionError,
  NOT_FOUND_LIBRARY_READ_MESSAGE,
  recordUnreadableMessage,
} from './library-read-errors';

describe('library read failure contract', () => {
  it('accepts only the strict public failure shape and the two published codes', () => {
    expect(
      libraryReadFailureSchema.safeParse({ id: 'record-1', code: 'RECORD_UNREADABLE', message: 'Read failed.' })
        .success,
    ).toBe(true);
    expect(
      libraryReadFailureSchema.safeParse({ id: 'record-1', code: 'NOT_FOUND', message: 'No such record.' }).success,
    ).toBe(true);
    expect(
      libraryReadFailureSchema.safeParse({
        id: 'record-1',
        code: 'RECORD_UNREADABLE',
        message: 'Read failed.',
        retryable: true,
      }).success,
    ).toBe(false);
    expect(libraryReadFailureSchema.safeParse({ id: 'record-1', code: 'OTHER', message: 'Read failed.' }).success).toBe(
      false,
    );
  });

  it('gives callers the same not-found message and an actionable unreadable message', () => {
    expect(NOT_FOUND_LIBRARY_READ_MESSAGE).toBe('No such credential record.');
    expect(recordUnreadableMessage('opaque-record-1')).toContain('opaque-record-1');
    expect(recordUnreadableMessage('opaque-record-1')).toContain('x-correlation-id response header');
  });

  it('marks selection-boundary failures as a distinct internal error', () => {
    const error = new LibraryRecordSelectionError('the returned id was not selected');

    expect(error).toBeInstanceOf(LibraryRecordSelectionError);
    expect(error.reason).toBe('selection-boundary');
    expect(error.message).toContain('the returned id was not selected');
  });
});
