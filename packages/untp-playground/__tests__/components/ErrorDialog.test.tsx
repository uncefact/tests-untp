/**
 * @jest-environment jsdom
 */

import { ErrorDialog } from '@/components/ErrorDialog';
import { classifyJsonLdFailure } from '@/lib/artefactFailure';
import { fireEvent, render, screen } from '@testing-library/react';

// Mock clipboard API
Object.assign(navigator, {
  clipboard: {
    writeText: jest.fn(),
  },
});

describe('ErrorDialog', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns null when no errors are provided', () => {
    const { container } = render(<ErrorDialog errors={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('returns null when errors is not an array', () => {
    // @ts-ignore - Testing invalid input
    const { container } = render(<ErrorDialog errors={{}} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders a fetch failure without field errors exactly once', () => {
    render(
      <ErrorDialog
        errors={[]}
        failure={{
          class: 'could-not-fetch',
          code: 'schema.fetch.timeout',
          message: 'The Playground could not fetch the artefact.',
          remediation: 'Retry the check and report the details if it keeps failing.',
        }}
      />,
    );

    expect(screen.getAllByTestId('validation-issue-card')).toHaveLength(1);
    expect(screen.getByText('Issue: The Playground could not fetch the artefact.')).toBeInTheDocument();
    expect(screen.getAllByText('Retry the check and report the details if it keeps failing.')).toHaveLength(1);
    expect(screen.queryByText(/Additional properties found/i)).not.toBeInTheDocument();
  });

  it('labels a synthesised failure card with its classified heading', () => {
    render(
      <ErrorDialog
        errors={[]}
        failure={{
          class: 'unknown',
          code: 'playground.pipeline.not-executed',
          message: 'This scheme step was not executed because step "Version Detection" failed first.',
          remediation: 'Review the first failed step.',
        }}
        family='scheme'
      />,
    );

    expect(screen.getByTestId('failure-card-heading')).toHaveTextContent('Not executed');
  });

  it('keeps fetched-schema diagnostics separate from credential correction guidance', () => {
    render(
      <ErrorDialog
        errors={[
          { keyword: 'type', instancePath: '', message: 'must be object', params: { type: 'object' }, data: 17 },
        ]}
        failure={{
          class: 'unusable-artefact',
          code: 'schema.validation.meta-schema',
          message: 'The fetched schema is not usable.',
          remediation: 'Report the schema to its publisher.',
          artefactUrl: 'https://publisher.example/schema.json',
        }}
      />,
    );

    expect(screen.getByText('These diagnostics describe the fetched schema, not the credential.')).toBeInTheDocument();
    expect(screen.getByText('Location: https://publisher.example/schema.json')).toBeInTheDocument();
    expect(screen.getByText('Report the schema to its publisher.')).toBeInTheDocument();
    expect(screen.queryByText(/Change the value to match the expected type/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /choose from allowed values/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /diagnostic details/i }));
    expect(screen.queryByText(/Try this instead/i)).not.toBeInTheDocument();
  });

  it('does not repeat the supported-type subject when no supported types were supplied', () => {
    render(
      <ErrorDialog
        errors={[
          {
            keyword: 'unsupportedCredentialType',
            instancePath: '',
            message: 'The declared type is not supported.',
            params: { supportedTypes: [] },
          },
        ]}
      />,
    );

    expect(screen.getByText(/Add the artefact on its own tab\. The Playground accepts:/i)).toBeInTheDocument();
    expect(screen.queryByText(/supported UNTP credential types: the supported UNTP types/i)).not.toBeInTheDocument();
  });

  it('renders one classified card for an established context fetch failure', () => {
    render(
      <ErrorDialog
        errors={[
          {
            keyword: 'jsonldUrl',
            instancePath: '@context',
            message: 'Could not load the context. Common causes: a host outage.',
            params: { code: 'resolver.http-error', url: 'https://publisher.example/context.jsonld' },
          },
        ]}
        failure={{
          class: 'could-not-fetch',
          code: 'context.fetch',
          message: 'The Playground context service answered 503.',
          remediation: 'Retry the check.',
          artefactUrl: 'https://publisher.example/context.jsonld',
          serviceStatus: 503,
        }}
      />,
    );

    expect(screen.getAllByTestId('validation-issue-card')).toHaveLength(1);
    expect(screen.getByTestId('validation-issue-card')).toHaveTextContent(
      'The Playground context service answered 503.',
    );
    expect(screen.getByText('Location: https://publisher.example/context.jsonld')).toBeInTheDocument();
    expect(screen.getByText('Service status: 503')).toBeInTheDocument();
    expect(screen.getByText('Retry the check.')).toBeInTheDocument();
    expect(screen.queryByText(/Common causes:/i)).not.toBeInTheDocument();
  });

  it('keeps diagnostic causes for an unknown failure because no class was established', () => {
    render(
      <ErrorDialog
        errors={[
          {
            keyword: 'jsonldUrl',
            instancePath: '@context',
            message: 'Could not load the context. Common causes: a host outage.',
            params: { code: 'resolver.http-error', url: 'https://publisher.example/context.jsonld' },
          },
        ]}
        failure={{
          class: 'unknown',
          code: 'context.document.unknown',
          message: 'The cause is not established.',
          remediation: 'Report these details to the Playground operator.',
        }}
      />,
    );

    expect(screen.getByText(/Common causes:/i)).toBeInTheDocument();
  });

  it('displays validation errors correctly', () => {
    const errors = [
      {
        keyword: 'type',
        instancePath: '/data/field1',
        params: { type: 'string' },
      },
      {
        keyword: 'required',
        instancePath: '/data',
        params: { missingProperty: 'requiredField' },
      },
    ] as any;

    render(<ErrorDialog errors={errors} />);

    // Check if error count is displayed
    expect(screen.getByText(/we found 2 issues/i)).toBeInTheDocument();

    // Check if error locations are displayed
    expect(screen.getAllByText(/data → field1/i)).toHaveLength(2);
    expect(screen.getByText(/wrong type/i)).toBeInTheDocument();
    expect(screen.getByText(/missing field/i)).toBeInTheDocument();
  });

  it('renders message-shaped issues and advisory diagnostics as drawer cards', () => {
    render(
      <ErrorDialog
        errors={[
          {
            message: 'The score entry is malformed.',
            pointer: '/includedProfile/0/score/1/code',
            tip: 'Keep the score entry aligned with the scheme.',
          },
          { message: 'The parser could not name this location.', supportable: true },
          { keyword: 'additionalProperties', instancePath: '', params: { additionalProperty: 'legacy' } },
        ]}
        failure={{
          class: 'credential-invalid',
          code: 'conformity-scheme.parse-failed',
          message: 'The scheme is invalid.',
          remediation: 'Correct the scheme.',
        }}
        family='scheme'
      />,
    );

    expect(screen.getByText('We Found 2 Issues')).toBeInTheDocument();
    expect(screen.getByText('Location: includedProfile → 0 → score → 1 → code')).toBeInTheDocument();
    expect(screen.getByText('Issue: The score entry is malformed.')).toBeInTheDocument();
    expect(screen.getByText('Keep the score entry aligned with the scheme.')).toBeInTheDocument();
    expect(screen.getByText('Issue: The parser could not name this location.')).toBeInTheDocument();
    expect(screen.getByText('Correct the scheme.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'report an issue' })).toBeInTheDocument();
    expect(screen.getByText('1 Warning')).toBeInTheDocument();
    expect(screen.getByText('Additional property: "legacy"')).toBeInTheDocument();
    expect(screen.getAllByTestId('validation-issue-card')).toHaveLength(2);
  });

  it('keeps the support link and supplied tip when a described error repeats the failure message', () => {
    render(
      <ErrorDialog
        errors={[{ message: 'The schema service failed.', supportable: true, tip: 'Report the service response.' }]}
        failure={{
          class: 'unknown',
          code: 'schema.unknown',
          message: 'The schema service failed.',
          remediation: 'Retry the check.',
        }}
      />,
    );

    expect(screen.getAllByTestId('validation-issue-card')).toHaveLength(1);
    expect(screen.getByText('Report the service response.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'report an issue' })).toBeInTheDocument();
  });

  it('decodes escaped JSON Pointer tokens in issue card paths', () => {
    render(
      <ErrorDialog
        errors={[
          {
            keyword: 'type',
            instancePath: '/linkset/0/https:~1~1test.uncefact.org~1voc~1untp~1dpp/0',
            params: { type: 'object' },
          },
        ]}
      />,
    );

    expect(screen.getByText('Location: linkset → 0 → https://test.uncefact.org/voc/untp/dpp → 0')).toBeInTheDocument();
  });

  it('displays warnings for additional properties', () => {
    const errors = [
      {
        keyword: 'additionalProperties',
        instancePath: '',
        params: { additionalProperty: 'extraField' },
      },
    ] as any;

    render(<ErrorDialog errors={errors} />);

    expect(screen.getByText(/1 warning/i)).toBeInTheDocument();
    expect(screen.getByText(/additional property: "extraField"/i)).toBeInTheDocument();
  });

  it('handles expandable error details', async () => {
    const errors = [
      {
        keyword: 'enum',
        instancePath: '/data/status',
        params: { allowedValues: ['active', 'inactive'] },
      },
    ] as any;

    render(<ErrorDialog errors={errors} />);

    // Click to expand error details
    const button = screen.getByRole('button', { name: /choose from allowed values/i });
    fireEvent.click(button);

    // Check if expanded content is visible
    expect(screen.getByText(/must be one of:/i)).toBeInTheDocument();
    expect(screen.getByText('active, inactive', { exact: true })).toBeInTheDocument();
  });

  it('handles copy functionality', async () => {
    const errors = [
      {
        keyword: 'const',
        instancePath: '/data/type',
        params: { allowedValue: 'user' },
      },
    ] as any;

    render(<ErrorDialog errors={errors} />);

    // Expand the error details
    const expandButton = screen.getByRole('button', { name: /use the correct value/i });
    fireEvent.click(expandButton);

    // Click copy button
    const copyButton = screen.getByRole('button', { name: /copy/i });
    fireEvent.click(copyButton);

    // Verify clipboard API was called
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('"user"');

    // Verify "Copied!" text appears
    expect(screen.getByText(/copied!/i)).toBeInTheDocument();
  });

  it('marks only the copied example when indexed errors share a group', () => {
    const errors = [
      {
        keyword: 'enum',
        instancePath: '/items/0',
        params: { allowedValues: ['first'] },
      },
      {
        keyword: 'enum',
        instancePath: '/items/1',
        params: { allowedValues: ['second'] },
      },
    ] as any;

    render(<ErrorDialog errors={errors} />);

    fireEvent.click(screen.getByRole('button', { name: /choose from allowed values/i }));

    const copyButtons = screen.getAllByRole('button', { name: /^Copy$/ });
    expect(copyButtons).toHaveLength(2);
    fireEvent.click(copyButtons[0]);

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('[\n  "first"\n]');
    expect(copyButtons[0]).toHaveTextContent('Copied!');
    expect(copyButtons[1]).toHaveTextContent('Copy');
    expect(screen.getAllByRole('button', { name: /^Copied!$/ })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: /^Copy$/ })).toHaveLength(1);
  });

  it('displays correct tips based on error type "const"', () => {
    const errors = [
      {
        keyword: 'const',
        instancePath: '/data/type',
        params: { allowedValue: 'user' },
      },
    ] as any;

    render(<ErrorDialog errors={errors} />);

    // Expand the error details
    const expandButton = screen.getByRole('button', { name: /use the correct value/i });
    fireEvent.click(expandButton);

    // Verify tip content
    expect(
      screen.getByText(/Update the value\(s\) to the correct one\(s\) or remove the field\(s\)/i),
    ).toBeInTheDocument();
  });

  it('displays correct tips based on error type "conflictingProperties"', () => {
    const errors = [
      {
        keyword: 'conflictingProperties',
        instancePath: '@context',
        params: { conflictingProperty: 'name' },
      },
    ] as any;

    render(<ErrorDialog errors={errors} />);

    expect(screen.getByTestId('validation-issue-card')).toHaveTextContent('Issue: Unknown validation error');
    expect(
      screen.getByText(/Resolve the conflict by removing the conflicting field or updating it to a unique one/i),
    ).toBeInTheDocument();
  });

  it('names supported credential types and artefact tabs for an unsupported type', () => {
    const errors = [
      {
        keyword: 'unsupportedCredentialType',
        instancePath: '',
        message: 'The declared type is not supported.',
        params: {
          supportedTypes: [
            'DigitalProductPassport',
            'DigitalConformityCredential',
            'DigitalFacilityRecord',
            'DigitalIdentityAnchor',
            'DigitalTraceabilityEvent',
          ],
        },
      },
    ] as any;

    render(<ErrorDialog errors={errors} />);

    expect(
      screen.getByText(
        /Add one of the supported UNTP credential types: DigitalProductPassport, DigitalConformityCredential, DigitalFacilityRecord, DigitalIdentityAnchor, DigitalTraceabilityEvent, or add the artefact on its own tab\. The Playground accepts: Verifiable Credential, Conformity Scheme, Link Set\./i,
      ),
    ).toBeInTheDocument();
  });

  it('groups multiple errors for the same path', () => {
    const errors = [
      {
        keyword: 'type',
        instancePath: '/data/field1',
        params: { type: 'string' },
      },
      {
        keyword: 'minLength',
        instancePath: '/data/field1',
        params: { limit: 3 },
      },
    ] as any;

    render(<ErrorDialog errors={errors} />);

    // The heading counts errors, while the body keeps one location group for '/data/field1'.
    expect(screen.getByText(/we found 2 issues/i)).toBeInTheDocument();
    expect(screen.getByText((_, element) => element?.textContent === 'Location: data → field1')).toBeInTheDocument();
  });

  it('renders every root required error in the collapsed summary and expanded details', () => {
    const errors = [
      {
        keyword: 'required',
        instancePath: '',
        message: "must have required property 'owner'",
        params: { missingProperty: 'owner' },
      },
      {
        keyword: 'required',
        instancePath: '',
        message: "must have required property 'documentation'",
        params: { missingProperty: 'documentation' },
      },
    ] as any;

    render(<ErrorDialog errors={errors} />);

    expect(screen.getByText('Missing required field: owner')).toBeInTheDocument();
    expect(screen.getByText('Missing required field: documentation')).toBeInTheDocument();
    expect(screen.getByText(/we found 2 issues/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /fix validation error/i }));
    expect(screen.getByText((_, element) => element?.textContent === 'Missing field: owner')).toBeInTheDocument();
    expect(
      screen.getByText((_, element) => element?.textContent === 'Missing field: documentation'),
    ).toBeInTheDocument();
  });

  it('applies custom className when provided', () => {
    const errors = [
      {
        keyword: 'type',
        instancePath: '/data/field1',
        params: { type: 'string' },
      },
    ] as any;

    const { container } = render(<ErrorDialog errors={errors} className='custom-class' />);
    expect(container.firstChild).toHaveClass('custom-class');
  });

  it('displays missingValue error details correctly', () => {
    const errors = [
      {
        keyword: 'missingValue',
        instancePath: '@context[0]',
        message: 'The first element of "@context" must be one of the following:',
        params: { allowedValues: ['https://www.w3.org/2018/credentials/v1', 'https://www.w3.org/ns/credentials/v2'] },
      },
    ] as any;

    render(<ErrorDialog errors={errors} />);

    expect(screen.getByTestId('validation-issue-card')).toHaveTextContent(
      'Issue: The first element of "@context" must be one of the following:',
    );
    expect(screen.getByTestId('validation-issue-card')).toHaveTextContent('missing value');
    expect(screen.getByTestId('validation-issue-card')).toHaveTextContent(
      'Make sure your input matches the required format.',
    );
    fireEvent.click(screen.getByRole('button', { name: /fix validation error/i }));
    expect(screen.getByText('Example:')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(JSON.stringify(errors[0].params.allowedValues, null, 2));
  });

  it('displays minItems error details correctly', () => {
    const errors = [
      {
        keyword: 'minItems',
        instancePath: '@context',
        message: 'The "@context" array must contain at least one item.',
        params: { minItems: 1 },
      },
    ] as any;

    render(<ErrorDialog errors={errors} />);

    expect(screen.getByText(/we found 1 issue/i)).toBeInTheDocument();

    const button = screen.getByRole('button');
    fireEvent.click(button);

    expect(screen.getByText(/expected minimum number of items:/i)).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();

    expect(screen.getByText(/too few items/i)).toBeInTheDocument();
  });

  describe('JSON-LD validation errors', () => {
    it('shows the dedicated header for an unmapped property', () => {
      const errors = [
        {
          keyword: 'jsonldValidation',
          instancePath: '',
          message: 'Property "mediaQuery" appears in the credential but isn\'t defined by any @context.',
          params: { code: 'invalid property', property: 'mediaQuery' },
        },
      ] as any;

      render(<ErrorDialog errors={errors} />);

      expect(screen.getByTestId('validation-issue-card')).toHaveTextContent(
        'Property "mediaQuery" appears in the credential',
      );
      expect(screen.queryByText(/Location:/i)).not.toBeInTheDocument();
    });

    it('renders the JSON-LD code as a small caption', () => {
      const errors = [
        {
          keyword: 'jsonldValidation',
          instancePath: '',
          message: 'something',
          params: { code: 'relative @id reference', id: 'foo' },
        },
      ] as any;

      render(<ErrorDialog errors={errors} />);
      expect(screen.getByTestId('validation-issue-card')).toHaveTextContent('Issue: something');
      fireEvent.click(screen.getByRole('button', { name: /diagnostic details/i }));
      expect(screen.getByText('JSON-LD code:')).toBeInTheDocument();
      expect(screen.getByText('relative @id reference')).toBeInTheDocument();
      expect(screen.getByTestId('validation-issue-card')).toHaveTextContent(
        'Report the JSON-LD diagnostic shown above.',
      );
    });

    it('shows a property-specific tip for invalid property errors', () => {
      const errors = [
        {
          keyword: 'jsonldValidation',
          instancePath: '',
          message: 'msg',
          params: { code: 'invalid property', property: 'mediaQuery' },
        },
      ] as any;

      render(
        <ErrorDialog
          errors={errors}
          failure={{
            class: 'credential-invalid',
            code: 'context.document.invalid-property',
            message: 'The credential uses property "mediaQuery", but no supplied JSON-LD context defines it.',
            remediation: 'Add "mediaQuery" to a context, or remove it from the credential.',
          }}
          family='context'
        />,
      );
      expect(screen.getByText(/Add "mediaQuery" to a @context, or remove it from the credential/i)).toBeInTheDocument();
    });

    it('shows an invalid property in the issue list when the drawer has Ajv errors', () => {
      const failure = classifyJsonLdFailure({
        kind: 'document',
        source: 'safe-mode-event',
        code: 'invalid property',
        detail: 'A property was not defined.',
      });
      render(
        <ErrorDialog
          errors={[
            {
              keyword: 'jsonldValidation',
              instancePath: '',
              message: 'A property was not defined.',
              params: { code: 'invalid property' },
            },
          ]}
          failure={failure}
          family='credential'
        />,
      );

      expect(screen.getByTestId('validation-issue-card')).toHaveTextContent('A property was not defined.');
      expect(screen.getByText(/A property was not defined\./)).toBeInTheDocument();
      expect(screen.queryByText(/undefined/)).not.toBeInTheDocument();
    });

    it('shows the classified fetch card for invalid context URL errors', () => {
      const errors = [
        {
          keyword: 'jsonldUrl',
          instancePath: '@context',
          message: 'Couldn\'t load the @context at "https://example.invalid/ctx".',
          params: { code: 'loading remote context failed', url: 'https://example.invalid/ctx' },
        },
      ] as any;

      render(
        <ErrorDialog
          errors={errors}
          failure={{
            class: 'could-not-fetch',
            code: 'context.fetch',
            message: 'The Playground could not fetch the JSON-LD context at "https://example.invalid/ctx".',
            remediation:
              'Retry the check. If it keeps failing, report the URL and these details to the Playground operator.',
            artefactUrl: 'https://example.invalid/ctx',
          }}
          family='context'
        />,
      );

      expect(screen.getAllByTestId('validation-issue-card')).toHaveLength(1);
      expect(screen.getByTestId('validation-issue-card')).toHaveTextContent(
        'The Playground could not fetch the JSON-LD context',
      );
      expect(screen.getByText('Location: https://example.invalid/ctx')).toBeInTheDocument();
      expect(screen.getByTestId('validation-issue-card')).toHaveTextContent(/Retry the check/);
      expect(screen.queryByText(/Couldn.t load the @context/i)).not.toBeInTheDocument();
    });

    it('shows the classified service failure when the context host failed after passing the guard', () => {
      const errors = [
        {
          keyword: 'jsonldUrl',
          instancePath: '@context',
          message: 'Couldn\'t load the @context at "https://example.invalid/ctx".',
          params: { kind: 'context-fetch', code: 'resolver.http-error', url: 'https://example.invalid/ctx' },
        },
      ] as any;

      render(
        <ErrorDialog
          errors={errors}
          failure={{
            class: 'could-not-fetch',
            code: 'context.fetch',
            message: 'The Playground could not fetch the JSON-LD context at "https://example.invalid/ctx".',
            remediation: 'Retry the check.',
            artefactUrl: 'https://example.invalid/ctx',
          }}
          family='context'
        />,
      );

      expect(screen.getAllByTestId('validation-issue-card')).toHaveLength(1);
      expect(screen.getByTestId('validation-issue-card')).toHaveTextContent(
        'The Playground could not fetch the JSON-LD context',
      );
      expect(screen.getByText('Location: https://example.invalid/ctx')).toBeInTheDocument();
      expect(screen.getByTestId('validation-issue-card')).toHaveTextContent('Retry the check.');
      expect(screen.queryByText(/change|rename|use a different/i)).not.toBeInTheDocument();
    });

    it('shows the classified unusable-artefact card for a fetched context that is not a context', () => {
      const errors = [
        {
          keyword: 'jsonldUrl',
          instancePath: '@context',
          message: 'The @context at "https://example.invalid/ctx" was fetched but isn\'t a usable JSON-LD context.',
          params: { kind: 'context-invalid', code: 'invalid remote context', url: 'https://example.invalid/ctx' },
        },
      ] as any;

      render(
        <ErrorDialog
          errors={errors}
          failure={{
            class: 'unusable-artefact',
            code: 'context.invalid',
            message: 'The JSON-LD context at "https://example.invalid/ctx" was fetched but is not usable.',
            remediation: 'Report the artefact URL and these details to its publisher or the Playground operator.',
            artefactUrl: 'https://example.invalid/ctx',
          }}
          family='context'
        />,
      );

      expect(screen.getAllByTestId('validation-issue-card')).toHaveLength(1);
      expect(screen.getByTestId('validation-issue-card')).toHaveTextContent(
        'The JSON-LD context at "https://example.invalid/ctx" was fetched but is not usable.',
      );
      expect(screen.getByText('Location: https://example.invalid/ctx')).toBeInTheDocument();
      expect(screen.getByTestId('validation-issue-card')).toHaveTextContent('Report the artefact URL');
      expect(screen.queryByText(/was fetched but isn.t a usable JSON-LD context/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/change|rename|use a different/i)).not.toBeInTheDocument();
    });

    it('shows a service header and tip when the context service itself failed', () => {
      const errors = [
        {
          keyword: 'jsonldService',
          instancePath: '',
          message: "The Playground's context service could not be reached (Failed to fetch). Retry in a moment.",
          params: { kind: 'unreachable' },
        },
      ] as any;

      render(
        <ErrorDialog
          errors={errors}
          failure={{
            class: 'could-not-fetch',
            code: 'context.service',
            message: 'The Playground context service could not be reached.',
            remediation: 'Retry the check. If it keeps failing, report the details to the Playground operator.',
          }}
          family='context'
        />,
      );

      expect(screen.getAllByTestId('validation-issue-card')).toHaveLength(1);
      expect(screen.getByTestId('validation-issue-card')).toHaveTextContent(
        'The Playground context service could not be reached.',
      );
      expect(screen.getByTestId('validation-issue-card')).toHaveTextContent('Retry the check.');
      expect(screen.queryByText(/change|rename|use a different/i)).not.toBeInTheDocument();
    });
  });

  describe('AJV verbose data', () => {
    it('shows the received value and a "Try this instead" snippet for type=array errors', () => {
      const errors = [
        {
          keyword: 'type',
          instancePath: '/renderMethod/0/type',
          message: 'must be array',
          params: { type: 'array' },
          data: 'WebRenderingTemplate2022',
        },
      ] as any;

      render(<ErrorDialog errors={errors} />);
      fireEvent.click(screen.getByRole('button'));

      expect(screen.getByText(/Received value \(string\):/i)).toBeInTheDocument();
      expect(screen.getAllByText(/WebRenderingTemplate2022/).length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText(/Try this instead:/i)).toBeInTheDocument();
      expect(screen.getByText(/Wrap the existing value in an array/i)).toBeInTheDocument();
    });

    it('does not render "Try this instead" when the value is already an array', () => {
      const errors = [
        {
          keyword: 'type',
          instancePath: '/renderMethod',
          message: 'must be array',
          params: { type: 'array' },
          data: ['already', 'an', 'array'],
        },
      ] as any;

      render(<ErrorDialog errors={errors} />);
      fireEvent.click(screen.getByRole('button'));

      expect(screen.queryByText(/Try this instead:/i)).not.toBeInTheDocument();
    });

    it('renders the received value when only error.data is present (no params.receivedValue)', () => {
      const errors = [
        {
          keyword: 'type',
          instancePath: '/age',
          message: 'must be number',
          params: { type: 'number' },
          data: 'forty-two',
        },
      ] as any;

      render(<ErrorDialog errors={errors} />);
      fireEvent.click(screen.getByRole('button'));

      expect(screen.getByText(/Received value \(string\):/i)).toBeInTheDocument();
      expect(screen.getByText(/"forty-two"/)).toBeInTheDocument();
    });
  });
});
