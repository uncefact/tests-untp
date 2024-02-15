/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-return */
import { IServices } from './types';

/**
 * Example function for IServices
 * @param data
 * @returns data
 */
export const consoleLog: IServices = (data: any) => {
  console.log('Log: ', data);
  return data;
};
