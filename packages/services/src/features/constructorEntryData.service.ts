import _ from 'lodash';

/**
 * This function is used to merge the data from the constructor entry
 * @param args
 * @returns the merged data
 */
export const constructorEntryData = (...args: any) => {
  if (_.isEmpty(args) || args.some((arg: any) => _.isNil(arg))) {
    throw new Error('No data provided');
  }

  const result = _.merge({}, ...Object.values(args).filter((item: any) => item.data));
  return result;
};
