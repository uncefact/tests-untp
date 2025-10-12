import module from 'module';

export function getPackageVersion(): string {
  const requireCjs = module.createRequire(import.meta.url);
  const { version } = requireCjs('../../package.json');

  return version;
}