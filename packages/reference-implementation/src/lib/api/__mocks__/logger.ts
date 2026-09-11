const logger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  child: jest.fn(),
};

logger.child.mockReturnValue(logger);

export const appLogger = logger;
export const apiLogger = logger;
