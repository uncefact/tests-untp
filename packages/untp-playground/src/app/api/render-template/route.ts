import Handlebars from 'handlebars';
import { NextResponse } from 'next/server';
import { readTemplate } from '@/lib/utils';

/**
 * Renders a Handlebars template with the provided data.
 * @param request - The report data to display in the template.
 * @returns The rendered HTML as a string.
 */
export async function POST(request: Request) {
  try {
    const data = await request.json();
    if (!data || typeof data !== 'object') {
      return new NextResponse('Invalid data provided', { status: 400 });
    }

    const templateName = 'untp-comformance-report-template';

    const templateContent = await readTemplate(templateName);
    const template = Handlebars.compile(templateContent);

    const html = template(data);

    return new NextResponse(html, {
      headers: { 'Content-Type': 'text/html' },
    });
  } catch (error) {
    console.error('Error:', error);
    return new NextResponse('Error rendering template', { status: 500 });
  }
}
