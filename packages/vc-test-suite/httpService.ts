import axios, { AxiosRequestConfig } from 'axios';
import { isPlainObject, every, isString } from 'lodash';

const defaultHeaders = {
  'Content-Type': 'application/json',
};

export const request = async (params: AxiosRequestConfig) => {
  if (params.headers) {
    if (!isPlainObject(params.headers) || !every(params.headers, isString)) {
      throw new Error('Headers specified in the config must be a plain object with string values.');
    }
  }

  const instance = axios.create({
    headers: {
      ...defaultHeaders,
      ...params.headers,
    },
  });

  const response = await instance.request(params);
  return response;
};
