import { makeBridge } from './make-bridge.js';
import type { BridgeEntities, CredentialSubject, ExtractedRefs, VersionSpec } from './types.js';

describe('makeBridge', () => {
  const mockEntities: BridgeEntities = {
    organisation: { id: 'org-1', name: 'Test Org' },
  };

  const mockSubject: CredentialSubject = {
    type: ['TestCredential'],
    value: 'test',
  };

  const mockRefs: ExtractedRefs = {
    organisation: { id: 'org-1' },
  };

  it('delegates buildSubject to spec.builder', () => {
    const builder = jest.fn().mockReturnValue(mockSubject);
    const extractor = jest.fn().mockReturnValue(mockRefs);
    const spec: VersionSpec = { builder, extractor };

    const bridge = makeBridge(spec);
    const result = bridge.buildSubject(mockEntities);

    expect(builder).toHaveBeenCalledWith(mockEntities);
    expect(result).toBe(mockSubject);
  });

  it('delegates extractRefs to spec.extractor', () => {
    const builder = jest.fn().mockReturnValue(mockSubject);
    const extractor = jest.fn().mockReturnValue(mockRefs);
    const spec: VersionSpec = { builder, extractor };

    const bridge = makeBridge(spec);
    const result = bridge.extractRefs(mockSubject);

    expect(extractor).toHaveBeenCalledWith(mockSubject);
    expect(result).toBe(mockRefs);
  });

  it('does not call extractor when buildSubject is invoked', () => {
    const builder = jest.fn().mockReturnValue(mockSubject);
    const extractor = jest.fn().mockReturnValue(mockRefs);
    const spec: VersionSpec = { builder, extractor };

    const bridge = makeBridge(spec);
    bridge.buildSubject(mockEntities);

    expect(extractor).not.toHaveBeenCalled();
  });

  it('does not call builder when extractRefs is invoked', () => {
    const builder = jest.fn().mockReturnValue(mockSubject);
    const extractor = jest.fn().mockReturnValue(mockRefs);
    const spec: VersionSpec = { builder, extractor };

    const bridge = makeBridge(spec);
    bridge.extractRefs(mockSubject);

    expect(builder).not.toHaveBeenCalled();
  });

  it('returns an object implementing IDataModelBridge', () => {
    const builder = jest.fn().mockReturnValue(mockSubject);
    const extractor = jest.fn().mockReturnValue(mockRefs);
    const spec: VersionSpec = { builder, extractor };

    const bridge = makeBridge(spec);

    expect(typeof bridge.buildSubject).toBe('function');
    expect(typeof bridge.extractRefs).toBe('function');
  });
});
