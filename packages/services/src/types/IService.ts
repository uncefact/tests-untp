export interface IService {
  (arg1: any, ...args: any[]): Promise<any>;
}
