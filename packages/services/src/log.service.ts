/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-return */
import { IService } from './types/index.js';

/**
 * Example function for IServices
 * @param data
 * @returns data
 */
export const consoleLog: IService = (data: any) => {
  console.log('Log: ', data);
  return data;
};
