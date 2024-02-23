export const getIdentifierByObjectKeyPaths = (data: any, keyPaths: string[]): any => {
  let value = data;

  for (const keyPath of keyPaths) {
    if (value[keyPath] === undefined) {
      return undefined;
    }
    value = value[keyPath];
  }
  return value;
};
