import { getValueByPath } from '../utils/helpers.js';
import { createLogger } from '../logging/factory.js';

const logger = createLogger().child({ module: 'localStorage.service' });

/**
 * This function is used to save data from the local storage
 * @param data
 * @param parameters key: string
 */
export const saveToLocalStorage = (data: any, parameters: { storageKey: string }) => {
  const { storageKey } = parameters;
  try {
    localStorage.setItem(storageKey, JSON.stringify(data));
  } catch (error: any) {
    logger.error({ error, storageKey }, 'Failed to save to local storage');
    throw new Error(error.message);
  }
};

/**
 * This function is used to append data to the key in the local storage
 * @param data
 * @param parameters key: string
 */
export const mergeToLocalStorage = (
  data: any,
  parameters: { storageKey: string; objectKeyPath?: string; objectValuePath?: string },
) => {
  const { storageKey } = parameters;
  try {
    const existingData = localStorage.getItem(storageKey);
    const value = parameters.objectValuePath ? getValueByPath(data, parameters.objectValuePath) : data;

    if (existingData) {
      const parsedData = JSON.parse(existingData);
      if (parameters.objectKeyPath) {
        const key = getValueByPath(data, parameters.objectKeyPath);

        localStorage.setItem(storageKey, JSON.stringify({ ...parsedData, [key]: value }));
      } else {
        localStorage.setItem(storageKey, JSON.stringify({ ...parsedData, ...value }));
      }
    } else {
      if (parameters.objectKeyPath) {
        const key = getValueByPath(data, parameters.objectKeyPath);

        localStorage.setItem(storageKey, JSON.stringify({ [key]: value }));
      } else {
        localStorage.setItem(storageKey, JSON.stringify({ ...value }));
      }
    }
  } catch (error: any) {
    logger.error({ error, storageKey }, 'Failed to merge to local storage');
    throw new Error(error.message);
  }
};

/**
 * This function is used to get the data from the local storage
 * @param parameters.storageKey - The key of the local storage item.
 * @param parameters.key - The key to be retrieved from the local storage item. If not provided, the entire item is returned.
 * @returns data
 */
export const getValueFromLocalStorage = (
  data: any,
  parameters: { storageKey: string; key?: string; stateKey?: string },
) => {
  const { storageKey, key } = parameters;
  try {
    const _data = { ...data };
    const existingData = localStorage.getItem(storageKey);
    let retrievedData;
    if (existingData) {
      const parsedData = JSON.parse(existingData);
      if (!key) {
        retrievedData = parsedData;
      } else {
        retrievedData = parsedData[key];
      }
    }
    if (parameters.stateKey) {
      _data[parameters.stateKey] = retrievedData;
      return _data;
    }
    return retrievedData;
  } catch (error: any) {
    logger.error({ error, storageKey }, 'Failed to get value from local storage');
    throw new Error(error.message);
  }
};

/**
 * Deletes specified keys from local storage.
 * @param parameters - The parameters for deleting values from local storage.
 * @param parameters.storageKey - The key of the local storage item.
 * @param parameters.keys - The keys to be deleted from the local storage item.
 * @throws {Error} If an error occurs during the deletion process.
 */
export const deleteValuesFromLocalStorage = (parameters: { storageKey: string; keys: string[] }) => {
  const { storageKey, keys } = parameters;
  try {
    const existingData = localStorage.getItem(storageKey);

    if (existingData) {
      const parsedData = JSON.parse(existingData);
      keys.forEach((key) => {
        delete parsedData[key];
      });
      localStorage.setItem(storageKey, JSON.stringify(parsedData));
    }
  } catch (error: any) {
    logger.error({ error, storageKey, keys }, 'Failed to delete values from local storage');
    throw new Error(error.message);
  }
};

/**
 * This function is used to delete the data from the local storage by storageKey
 * @param parameters key: string
 */
export const deleteItemFromLocalStorage = (parameters: { storageKey: string }) => {
  const { storageKey } = parameters;
  try {
    localStorage.removeItem(storageKey);
  } catch (error: any) {
    logger.error({ error, storageKey }, 'Failed to delete item from local storage');
    throw new Error(error.message);
  }
};
