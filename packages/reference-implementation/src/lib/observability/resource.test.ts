/**
 * @jest-environment node
 */
import { buildResource } from './resource';

describe('buildResource', () => {
  const originalEnv = process.env.DEPLOYMENT_ENVIRONMENT;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.DEPLOYMENT_ENVIRONMENT;
    } else {
      process.env.DEPLOYMENT_ENVIRONMENT = originalEnv;
    }
  });

  it('sets service.name to reference-implementation', () => {
    const resource = buildResource({ serviceVersion: '1.2.3' });

    expect(resource.attributes['service.name']).toBe('reference-implementation');
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
});
