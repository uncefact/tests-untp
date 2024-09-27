import { allowedIndexKeys, extractFromElementString } from '@mock-app/services';
import { Box } from '@mui/material';
import JSONPointer from 'jsonpointer';
import { useEffect, useState } from 'react';
import Barcode from 'react-barcode';

export interface IBarcodeProps {
  data?: string[];
  dataPath?: string;
}
export const BarcodeGenerator = (props: IBarcodeProps) => {
  const [values, setValues] = useState<string[]>([]);
  useEffect(() => {
    if (props.data && props.dataPath) {
      const pathIndex = props.dataPath.split('/').findIndex((key) => allowedIndexKeys.includes(key));

      if (pathIndex === -1) {
        setValues([constructBarcode(JSONPointer.get(props.data, props.dataPath))]);
      } else {
        const headPath = props.dataPath.split('/').slice(0, pathIndex).join('/');
        const tailPath = props.dataPath
          .split('/')
          .slice(pathIndex + 1)
          .join('/');
        const array = JSONPointer.get(props.data, headPath);
        const values = array.map((item: any) => JSONPointer.get(item, `/${tailPath}`));
        const parsedValues = values.map((item: any) => {
          return constructBarcode(item);
        });

        setValues(parsedValues);
      }
    }
  }, [props.data, props.dataPath]);

  const constructBarcode = (data: string) => {
    const convertToGS1String = (obj: any) => {
      if (typeof obj !== 'object' || obj === null) return '';

      let result = '';

      // Handle '01' (01) first if it exists
      if ('01' in obj) {
        let value = obj['01'];
        if (!/^\d{12,14}|\d{8}$/.test(value)) throw new Error('Invalid GTIN: ' + value);
        value = value.padStart(14, '0');
        result += `(01)${value}`;
      }

      // Handle all other AIs
      for (const [ai, value] of Object.entries(obj) as any) {
        if (ai === '01') continue; // Skip '01' as it's already handled

        if (!/^\d{2,4}$/.test(ai)) throw new Error(`Invalid AI: ${ai}`);

        result += `(${ai})${value}`;
      }

      return result;
    };

    const aiArray = extractFromElementString(data);

    return convertToGS1String(aiArray);
  };

  return (
    <Box display='flex' flexDirection='column' alignItems='center' justifyContent='space-evenly'>
      {values.map((item) => {
        return (
          <Box>
            <Barcode value={item} />
          </Box>
        );
      })}
    </Box>
  );
};
