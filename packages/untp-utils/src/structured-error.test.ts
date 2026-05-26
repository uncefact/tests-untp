import { StructuredError, type StructuredErrorInit } from './structured-error.js';

describe('StructuredError', () => {
  describe('constructor', () => {
    it('assigns code and message', () => {
      const e = new StructuredError({ code: 'demo.code', message: 'demo message' });
      expect(e.code).toBe('demo.code');
      expect(e.message).toBe('demo message');
    });

    it('assigns received / expected / remediation / pointer when supplied', () => {
      const e = new StructuredError({
        code: 'demo.code',
        message: 'm',
        received: { foo: 1 },
        expected: 'bar',
        remediation: 'do something',
        pointer: '/foo/bar',
      });
      expect(e.received).toEqual({ foo: 1 });
      expect(e.expected).toBe('bar');
      expect(e.remediation).toBe('do something');
      expect(e.pointer).toBe('/foo/bar');
    });

    it('leaves optional fields undefined when not supplied', () => {
      const e = new StructuredError({ code: 'c', message: 'm' });
      expect(e.received).toBeUndefined();
      expect(e.expected).toBeUndefined();
      expect(e.remediation).toBeUndefined();
      expect(e.pointer).toBeUndefined();
    });

    it('omits absent optional fields from the instance (in-operator returns false)', () => {
      const e = new StructuredError({ code: 'c', message: 'm' });
      expect('received' in e).toBe(false);
      expect('expected' in e).toBe(false);
      expect('remediation' in e).toBe(false);
      expect('pointer' in e).toBe(false);
    });

    it('includes supplied optional fields on the instance (in-operator returns true)', () => {
      const e = new StructuredError({ code: 'c', message: 'm', received: 'x', pointer: '/y' });
      expect('received' in e).toBe(true);
      expect('pointer' in e).toBe(true);
      expect('expected' in e).toBe(false);
      expect('remediation' in e).toBe(false);
    });
  });

  describe('Error.cause integration', () => {
    it('wires cause through to the underlying Error', () => {
      const underlying = new Error('boom');
      const e = new StructuredError({ code: 'c', message: 'm', cause: underlying });
      expect(e.cause).toBe(underlying);
    });

    it('omits cause from the underlying Error when not supplied', () => {
      const e = new StructuredError({ code: 'c', message: 'm' });
      expect(e.cause).toBeUndefined();
    });

    it('accepts non-Error causes (string, object, etc.)', () => {
      const e = new StructuredError({ code: 'c', message: 'm', cause: 'string cause' });
      expect(e.cause).toBe('string cause');
    });
  });

  describe('name', () => {
    it('resolves to the concrete subclass name in stack traces and logs', () => {
      class PrivateAddressError extends StructuredError {}
      const e = new PrivateAddressError({ code: 'url.private-address', message: 'm' });
      expect(e.name).toBe('PrivateAddressError');
    });

    it('uses StructuredError when constructed directly (not via a subclass)', () => {
      const e = new StructuredError({ code: 'c', message: 'm' });
      expect(e.name).toBe('StructuredError');
    });
  });

  describe('instanceof and Error inheritance', () => {
    it('is an instance of Error', () => {
      const e = new StructuredError({ code: 'c', message: 'm' });
      expect(e).toBeInstanceOf(Error);
    });

    it('is an instance of StructuredError when constructed directly', () => {
      const e = new StructuredError({ code: 'c', message: 'm' });
      expect(e).toBeInstanceOf(StructuredError);
    });

    it('preserves the StructuredError instanceof check for concrete subclasses', () => {
      class SubError extends StructuredError {}
      const e = new SubError({ code: 'c', message: 'm' });
      expect(e).toBeInstanceOf(SubError);
      expect(e).toBeInstanceOf(StructuredError);
      expect(e).toBeInstanceOf(Error);
    });
  });

  describe('throwability', () => {
    it('round-trips through try/catch as the concrete subclass', () => {
      class DemoError extends StructuredError {
        readonly extraField: string;
        constructor(init: StructuredErrorInit & { extraField: string }) {
          super(init);
          this.extraField = init.extraField;
        }
      }
      let caught: unknown;
      try {
        throw new DemoError({ code: 'demo.x', message: 'm', extraField: 'value' });
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(DemoError);
      expect((caught as DemoError).extraField).toBe('value');
      expect((caught as DemoError).code).toBe('demo.x');
    });
  });
});
