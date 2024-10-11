import {
  deleteItemFromLocalStorage,
  deleteValuesFromLocalStorage,
  mergeToLocalStorage,
  saveToLocalStorage,
} from '../../features/localStorage.service';

describe('saveToLocalStorage', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should save the data to local storage', () => {
    const spySetItem = jest.spyOn(Storage.prototype, 'setItem');
    const data = { a: 1 };
    const parameters = { storageKey: 'key' };
    saveToLocalStorage(data, parameters);
    expect(spySetItem).toHaveBeenCalledWith('key', JSON.stringify(data));
  });

  it('should throw an error if an error occurs', () => {
    const spySetItem = jest.spyOn(Storage.prototype, 'setItem');
    const data = { a: 1 };
    const parameters = { storageKey: 'key' };
    const error = new Error('An error occurred');
    spySetItem.mockImplementationOnce(() => {
      throw error;
    });
    expect(() => saveToLocalStorage(data, parameters)).toThrow(error);
  });
});

describe('mergeToLocalStorage', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should merge the data to local storage when not existing', () => {
    const spyGetItem = jest.spyOn(Storage.prototype, 'getItem');
    const spySetItem = jest.spyOn(Storage.prototype, 'setItem');
    const data = { a: 1 };
    const parameters = { storageKey: 'key', objectKeyPath: '/a' };
    spyGetItem.mockReturnValueOnce(JSON.stringify(null));
    mergeToLocalStorage(data, parameters);
    expect(spySetItem).toHaveBeenCalledWith('key', JSON.stringify({ 1: { a: 1 } }));
  });

  it('should merge the data to local storage when existing', () => {
    const spyGetItem = jest.spyOn(Storage.prototype, 'getItem');
    const spySetItem = jest.spyOn(Storage.prototype, 'setItem');
    const data = { a: 1 };
    const parameters = { storageKey: 'key', objectKeyPath: '/a' };
    spyGetItem.mockReturnValueOnce(JSON.stringify({ 2: { a: 2 } }));
    mergeToLocalStorage(data, parameters);
    expect(spySetItem).toHaveBeenCalledWith('key', JSON.stringify({ 2: { a: 2 }, 1: { a: 1 } }));
  });

  it('should merge the data to local storage when not existing data and objectKeyPath parameter is not provided', () => {
    const spyGetItem = jest.spyOn(Storage.prototype, 'getItem');
    const spySetItem = jest.spyOn(Storage.prototype, 'setItem');
    const data = { a: 1 };
    const parameters = { storageKey: 'key' };
    spyGetItem.mockReturnValueOnce(JSON.stringify(null));
    mergeToLocalStorage(data, parameters);
    expect(spySetItem).toHaveBeenCalledWith('key', JSON.stringify({ a: 1 }));
  });

  it('should merge the data to local storage when existing data and objectKeyPath parameter is not provided', () => {
    const spyGetItem = jest.spyOn(Storage.prototype, 'getItem');
    const spySetItem = jest.spyOn(Storage.prototype, 'setItem');
    const data = { a: 1 };
    const parameters = { storageKey: 'key' };
    spyGetItem.mockReturnValueOnce(JSON.stringify({ a: 3, b: 2 }));
    mergeToLocalStorage(data, parameters);
    expect(spySetItem).toHaveBeenCalledWith('key', JSON.stringify({ a: 1, b: 2 }));
  });

  it('should throw error when invalid objectKeyPath is provided', () => {
    const spyGetItem = jest.spyOn(Storage.prototype, 'getItem');
    const data = { a: 1 };
    const parameters = { storageKey: 'key', objectKeyPath: 'invalid' };
    spyGetItem.mockReturnValueOnce(JSON.stringify({ a: 2 }));
    expect(() => mergeToLocalStorage(data, parameters)).toThrow();
  });

  it('should throw an error if an error occurs', () => {
    const spyGetItem = jest.spyOn(Storage.prototype, 'getItem');
    const spySetItem = jest.spyOn(Storage.prototype, 'setItem');
    const data = { a: 1 };
    const parameters = { storageKey: 'key', objectKeyPath: '/a' };
    const error = new Error('An error occurred');
    spyGetItem.mockReturnValueOnce(JSON.stringify({ a: 2 }));
    spySetItem.mockImplementationOnce(() => {
      throw error;
    });
    expect(() => mergeToLocalStorage(data, parameters)).toThrow(error);
  });
});

describe('deleteValuesFromLocalStorage', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should delete the values from local storage', () => {
    const spyGetItem = jest.spyOn(Storage.prototype, 'getItem');
    const spySetItem = jest.spyOn(Storage.prototype, 'setItem');
    const data = { a: 1, b: 2 };
    const parameters = { storageKey: 'key', keys: ['a'] };
    spyGetItem.mockReturnValueOnce(JSON.stringify(data));
    deleteValuesFromLocalStorage(parameters);
    expect(spySetItem).toHaveBeenCalledWith('key', JSON.stringify({ b: 2 }));
  });

  it('should not delete the values from local storage if the key does not exist', () => {
    const spyGetItem = jest.spyOn(Storage.prototype, 'getItem');
    const spySetItem = jest.spyOn(Storage.prototype, 'setItem');
    const parameters = { storageKey: 'key', keys: ['a'] };
    spyGetItem.mockReturnValueOnce(JSON.stringify({ b: 2 }));
    deleteValuesFromLocalStorage(parameters);
    expect(spySetItem).toHaveBeenCalledWith('key', JSON.stringify({ b: 2 }));
  });

  it('should throw an error if an error occurs', () => {
    const spyGetItem = jest.spyOn(Storage.prototype, 'getItem');
    const spySetItem = jest.spyOn(Storage.prototype, 'setItem');
    const data = { a: 1, b: 2 };
    const parameters = { storageKey: 'key', keys: ['a'] };
    const error = new Error('An error occurred');
    spyGetItem.mockReturnValueOnce(JSON.stringify(data));
    spySetItem.mockImplementationOnce(() => {
      throw error;
    });
    expect(() => deleteValuesFromLocalStorage(parameters)).toThrow(error);
  });
});

describe('deleteItemFromLocalStorage', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should delete the item from local storage', () => {
    const spyRemoveItem = jest.spyOn(Storage.prototype, 'removeItem');
    const parameters = { storageKey: 'key' };
    deleteItemFromLocalStorage(parameters);
    expect(spyRemoveItem).toHaveBeenCalledWith('key');
  });

  it('should throw an error if an error occurs', () => {
    const spyRemoveItem = jest.spyOn(Storage.prototype, 'removeItem');
    const parameters = { storageKey: 'key' };
    const error = new Error('An error occurred');
    spyRemoveItem.mockImplementationOnce(() => {
      throw error;
    });
    expect(() => deleteItemFromLocalStorage(parameters)).toThrow(error);
  });
});
