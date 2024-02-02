import { IServices } from './types';

/**
 * Example function is called in Generic page, returns the data it receives
 * @param data
 * @returns data
 */
export const getFormInfo: IServices['getFormInfo'] = (data: unknown) => {
  console.log(data);
  return data;
};
