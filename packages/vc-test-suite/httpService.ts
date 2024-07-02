import axios, { AxiosRequestConfig, AxiosResponse } from 'axios';

const defaultHeaders = {
  'Content-Type': 'application/json',
};

export const request = async (params: AxiosRequestConfig) => {
  const instance = axios.create({
    headers: defaultHeaders,
  });

  instance.interceptors.response.use(
    (response: AxiosResponse) => {
      return response;
    },
    (error) => {
      return Promise.reject(error);
    },
  );
  const response = await instance.request(params);
  if (response.status >= 200 && response.status < 300) {
    return response.data;
  }
};
