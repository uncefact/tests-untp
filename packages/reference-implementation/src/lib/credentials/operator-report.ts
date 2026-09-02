/**
 * The operator-facing report the audit and the rotation render: lines tagged
 * with the stream they go to, and an exit code. Kept separate from the CLI's
 * process wiring so the output contract is testable.
 */

/** One line of a report, tagged with its stream. */
export type ReportLine = { text: string; stream: 'out' | 'err' };

export type Report = { lines: ReportLine[]; exitCode: 0 | 1 };

/** A report under construction: `out` and `err` append a line, `ids` appends a labelled id list on stderr when it is not empty. */
export function reportLines() {
  const lines: ReportLine[] = [];
  const out = (text: string) => lines.push({ text, stream: 'out' });
  const err = (text: string) => lines.push({ text, stream: 'err' });
  const ids = (label: string, rowIds: string[]) => {
    if (rowIds.length > 0) {
      err(`  ${label} (${rowIds.length}): ${rowIds.join(', ')}`);
    }
  };
  return { lines, out, err, ids };
}
