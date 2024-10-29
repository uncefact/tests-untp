import axios, { AxiosRequestConfig } from 'axios';
import _ from 'lodash';

const defaultHeaders = {
  'Content-Type': 'application/json',
};

export const request = async (params: AxiosRequestConfig) => {
  if (params.headers) {
    if (!_.isPlainObject(params.headers) || !_.every(params.headers, (value) => _.isString(value))) {
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
