import { allowedIndexKeys } from '@mock-app/services';
import { Box, Container } from '@mui/material';
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
        setValues(JSONPointer.get(props.data, props.dataPath));
      } else {
        const headPath = props.dataPath.split('/').slice(0, pathIndex).join('/');
        const tailPath = props.dataPath
          .split('/')
          .slice(pathIndex + 1)
          .join('/');
        const array = JSONPointer.get(props.data, headPath);
        const values = array.map((item: any) => JSONPointer.get(item, `/${tailPath}`));
        setValues(values);
      }
    }
  }, [props.data, props.dataPath]);
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
