import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';

const defaultHeaders = {
  'Content-Type': 'application/json',
};

/**
 * Config Axios instance with default value and use it to make http request
 */
class BaseAPI {
  protected axiosInstance: AxiosInstance;

  constructor() {
    /**
     * Create axios instance with default headers
     */
    this.axiosInstance = axios.create({
      headers: defaultHeaders,
    });

    this.axiosInstance.interceptors.response.use(
      (response: AxiosResponse) => {
        return response;
      },
      (error) => {
        return Promise.reject(error);
      },
    );
  }

  /**
   * Set bearer token authorization headers for axios instance
   * @param token
   */
  setBearerTokenAuthorizationHeaders(token: string) {
    this.axiosInstance.defaults.headers.common['Authorization'] = `Bearer ${token}`;
  }

  /**
   * Set content type header for axios instance
   * @param contentType
   */
  setContentTypeHeader(contentType: string) {
    this.axiosInstance.defaults.headers.common['Content-Type'] = contentType;
  }

  /**
   * Handle response from axios instance with method like get, post, put
   * @param response
   * @returns response data
   */
  handleResponse(response: AxiosResponse) {
    if (response.status >= 200 && response.status < 300) {
      return response.data;
    }
  }

  /**
   * Make get request with axios instance
   * @param url
   * @param config change default config of axios instance
   * @returns response data or error
   */
  public async get<T = any>(url: string, config?: AxiosRequestConfig) {
    try {
      const response = await this.axiosInstance.get<T>(url, config);
      return this.handleResponse(response);
    } catch (error) {
      throw new Error('Request failed with get method');
    }
  }

  /**
   * Make post request with axios instance
   * @param url
   * @param data body of request
   * @param config change default config of axios instance
   * @returns response data or error
   */
  public async post<T = any>(url: string, data?: any, config?: AxiosRequestConfig) {
    try {
      const response = await this.axiosInstance.post<T>(url, data, config);
      return this.handleResponse(response);
    } catch (error) {
      throw new Error('Request failed with get method');
    }
  }

  /**
   * Make put request with axios instance
   * @param url
   * @param data body of request
   * @param config change default config of axios instance
   * @returns response data or error
   */
  public async put<T = any>(url: string, data?: any, config?: AxiosRequestConfig) {
    try {
      const response = await this.axiosInstance.put<T>(url, data, config);
      return this.handleResponse(response);
    } catch (error) {
      throw new Error('Request failed with get method');
    }
  }
}

/**
 * Public API for making http request without authorization
 */
class PublicAPI extends BaseAPI {
  private static instance: PublicAPI;

  constructor() {
    super();
  }

  public static getInstance(): PublicAPI {
    if (!PublicAPI.instance) {
      PublicAPI.instance = new PublicAPI();
    }

    return PublicAPI.instance;
  }
}

/**
 * Private API for making http request with authorization
 */
class PrivateAPI extends BaseAPI {
  private static instance: PrivateAPI;

  constructor() {
    super();
  }

  public static getInstance(): PrivateAPI {
    if (!PrivateAPI.instance) {
      PrivateAPI.instance = new PrivateAPI();
    }

    return PrivateAPI.instance;
  }
}

export const publicAPI = PublicAPI.getInstance();
export const privateAPI = PrivateAPI.getInstance();
