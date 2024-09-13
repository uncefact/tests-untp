import { getValueByPath } from '../utils/helpers.js';

/**
 * This function is used to save data from the local storage
 * @param data
 * @param parameters key: string
 */
export const saveToLocalStorage = (data: any, parameters: any) => {
  try {
    const { storageKey } = parameters;
    localStorage.setItem(storageKey, JSON.stringify(data));
  } catch (error: any) {
    console.error(error);
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
  parameters: { storageKey: string; objectKeyPath: string; objectValuePath?: string },
) => {
  try {
    const { storageKey, objectKeyPath } = parameters;
    const existingData = localStorage.getItem(storageKey);
    const key = getValueByPath(data, objectKeyPath);
    const value = parameters.objectValuePath ? getValueByPath(data, parameters.objectValuePath) : data;

    if (existingData) {
      const parsedData = JSON.parse(existingData);
      localStorage.setItem(storageKey, JSON.stringify({ ...parsedData, [key]: value }));
    } else {
      localStorage.setItem(storageKey, JSON.stringify({ [key]: value }));
    }
  } catch (error: any) {
    console.error(error);
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
  try {
    const { storageKey, keys } = parameters;
    const existingData = localStorage.getItem(storageKey);

    if (existingData) {
      const parsedData = JSON.parse(existingData);
      keys.forEach((key) => {
        delete parsedData[key];
      });
      localStorage.setItem(storageKey, JSON.stringify(parsedData));
    }
  } catch (error: any) {
    console.error(error);
    throw new Error(error.message);
  }
};

/**
 * This function is used to delete the data from the local storage by storageKey
 * @param parameters key: string
 */
export const deleteItemFromLocalStorage = (parameters: { storageKey: string }) => {
  try {
    const { storageKey } = parameters;
    localStorage.removeItem(storageKey);
  } catch (error: any) {
    console.error(error);
    throw new Error(error.message);
  }
};
