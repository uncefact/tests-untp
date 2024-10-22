import axios, { AxiosRequestConfig } from 'axios';
import { isPlainObject, every, isString } from 'lodash';
const defaultHeaders = {
  'Content-Type': 'application/json',
};

export const request = async (params: AxiosRequestConfig) => {
  const instance = axios.create({
    headers: defaultHeaders,
  });

  // Check if user defined headers is an object and contains only string values
  if (params.headers) {
    if (!isPlainObject(params.headers) || !every(params.headers, isString)) {
      throw new Error('Headers specified in the config must be a plain object with string values.');
    }
  }

  const response = await instance.request(params);
  return response;
};
