import handlebars from 'handlebars';
import { buildReportView } from '@/lib/reportView';
import templateContent from '@/lib/templates/untp-conformance-report-template.hbs';
import { downloadFile } from '@/lib/utils';
import type { TestReport } from '@/types';

handlebars.registerHelper('eq', (a: unknown, b: unknown) => a === b);

handlebars.registerHelper('formatDate', (value: unknown) => {
  if (typeof value !== 'string') return value;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
});

/**
 * Renders the report through the HTML template and downloads it. The template reads the view
 * built by `buildReportView` (grouping and card copy the JSON does not carry), so the HTML and
 * JSON downloads describe the same report.
 * @param report The generated report.
 * @param filename The download name; `.html` is appended when missing.
 */
export const downloadHtml = async (report: TestReport, filename: string) => {
  if (!filename.endsWith('.html')) {
    filename = `${filename}.html`;
  }

  try {
    const template = handlebars.compile(templateContent);
    const html = template({ credentialSubject: buildReportView(report) });
    downloadFile(html, filename, 'text/html');
  } catch (error) {
    throw new Error('Failed to download HTML report', { cause: error });
  }
};
