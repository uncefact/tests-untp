/**
 * @jest-environment node
 */
import { buildResource, resolveServiceName } from './resource';

describe('buildResource', () => {
  const originalEnv = process.env.DEPLOYMENT_ENVIRONMENT;
  const originalServiceName = process.env.OTEL_SERVICE_NAME;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.DEPLOYMENT_ENVIRONMENT;
    } else {
      process.env.DEPLOYMENT_ENVIRONMENT = originalEnv;
    }
    if (originalServiceName === undefined) {
      delete process.env.OTEL_SERVICE_NAME;
    } else {
      process.env.OTEL_SERVICE_NAME = originalServiceName;
    }
  });

  it('defaults service.name to reference-implementation when no env or override is set', () => {
    delete process.env.OTEL_SERVICE_NAME;

    const resource = buildResource({ serviceVersion: '1.2.3' });

    expect(resource.attributes['service.name']).toBe('reference-implementation');
  });

  it('uses OTEL_SERVICE_NAME from the process env when no override is provided', () => {
    process.env.OTEL_SERVICE_NAME = 'ri-staging';

    const resource = buildResource({ serviceVersion: '1.2.3' });

    expect(resource.attributes['service.name']).toBe('ri-staging');
  });

  it('lets the serviceName override beat OTEL_SERVICE_NAME', () => {
    process.env.OTEL_SERVICE_NAME = 'ri-staging';

    const resource = buildResource({ serviceVersion: '1.2.3', serviceName: 'ri-test' });

    expect(resource.attributes['service.name']).toBe('ri-test');
  });

  it('treats an empty OTEL_SERVICE_NAME value as absent and falls back to the default', () => {
    process.env.OTEL_SERVICE_NAME = '';

    const resource = buildResource({ serviceVersion: '1.2.3' });

    expect(resource.attributes['service.name']).toBe('reference-implementation');
  });

  it('treats a whitespace-only OTEL_SERVICE_NAME value as absent', () => {
    process.env.OTEL_SERVICE_NAME = '   ';

    const resource = buildResource({ serviceVersion: '1.2.3' });

    expect(resource.attributes['service.name']).toBe('reference-implementation');
  });

  it('treats an empty serviceName override as absent and falls through to env', () => {
    process.env.OTEL_SERVICE_NAME = 'ri-staging';

    const resource = buildResource({ serviceVersion: '1.2.3', serviceName: '' });

    expect(resource.attributes['service.name']).toBe('ri-staging');
  });

  it('treats a whitespace-only serviceName override as absent and falls through to env', () => {
    process.env.OTEL_SERVICE_NAME = 'ri-staging';

    const resource = buildResource({ serviceVersion: '1.2.3', serviceName: '   ' });

    expect(resource.attributes['service.name']).toBe('ri-staging');
  });

  it('resolveServiceName trims a padded OTEL_SERVICE_NAME and applies the same precedence', () => {
    process.env.OTEL_SERVICE_NAME = '  ri-staging  ';

    expect(resolveServiceName()).toBe('ri-staging');
    expect(resolveServiceName(' ri-test ')).toBe('ri-test');
    delete process.env.OTEL_SERVICE_NAME;
    expect(resolveServiceName()).toBe('reference-implementation');
  });

  it('uses the provided serviceVersion override', () => {
    const resource = buildResource({ serviceVersion: '9.9.9' });

    expect(resource.attributes['service.version']).toBe('9.9.9');
  });

  it('reads service.version from package.json when not overridden', () => {
    const resource = buildResource();

    // Package version is whatever package.json currently declares; assert
    // shape rather than value so the test does not need updating on every
    // version bump.
    expect(typeof resource.attributes['service.version']).toBe('string');
    expect(resource.attributes['service.version']).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('defaults deployment.environment.name to "local" when no env or override is set', () => {
    delete process.env.DEPLOYMENT_ENVIRONMENT;

    const resource = buildResource({ serviceVersion: '1.2.3' });

    expect(resource.attributes['deployment.environment.name']).toBe('local');
  });

  it('uses DEPLOYMENT_ENVIRONMENT from the process env when no override is provided', () => {
    process.env.DEPLOYMENT_ENVIRONMENT = 'staging';

    const resource = buildResource({ serviceVersion: '1.2.3' });

    expect(resource.attributes['deployment.environment.name']).toBe('staging');
  });

  it('lets the deploymentEnvironment override beat the process env', () => {
    process.env.DEPLOYMENT_ENVIRONMENT = 'staging';

    const resource = buildResource({
      serviceVersion: '1.2.3',
      deploymentEnvironment: 'dev',
    });

    expect(resource.attributes['deployment.environment.name']).toBe('dev');
  });

  it('treats an empty DEPLOYMENT_ENVIRONMENT value as absent and falls back to "local"', () => {
    process.env.DEPLOYMENT_ENVIRONMENT = '';

    const resource = buildResource({ serviceVersion: '1.2.3' });

    expect(resource.attributes['deployment.environment.name']).toBe('local');
  });

  it('treats a whitespace-only DEPLOYMENT_ENVIRONMENT value as absent', () => {
    process.env.DEPLOYMENT_ENVIRONMENT = '   ';

    const resource = buildResource({ serviceVersion: '1.2.3' });

    expect(resource.attributes['deployment.environment.name']).toBe('local');
  });

  it('treats an empty deploymentEnvironment override as absent and falls through to env', () => {
    process.env.DEPLOYMENT_ENVIRONMENT = 'staging';

    const resource = buildResource({
      serviceVersion: '1.2.3',
      deploymentEnvironment: '',
    });

    expect(resource.attributes['deployment.environment.name']).toBe('staging');
  });
});
