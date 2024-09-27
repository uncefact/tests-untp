import axios, { AxiosRequestConfig } from 'axios';

const defaultHeaders = {
  'Content-Type': 'application/json',
};

export const request = async (params: AxiosRequestConfig) => {
  const instance = axios.create({
    headers: defaultHeaders,
  });

  const response = await instance.request(params);
  return response;
};
