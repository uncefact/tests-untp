import { extractFromElementString, constructIdentifierData, constructElementString } from '@mock-app/services';
import { Box } from '@mui/material';
import { useEffect, useState } from 'react';
import Barcode from 'react-barcode';
import appConfig from '../../constants/app-config.json';
import { DataCarrierType } from '../../types/common.types';
import { toastMessage, Status } from '../ToastMessage/ToastMessage';

export interface IBarcodeProps {
  data?: string[];
  dataPath?: string;
}
export const BarcodeGenerator = (props: IBarcodeProps) => {
  const [values, setValues] = useState<string[]>([]);
  useEffect(() => {
    if (props.data && props.dataPath) {
      const aiData = constructIdentifierData(props.dataPath, props.data);
      if (validateData(aiData)) {
        const elementString = constructElementString(aiData);
        setValues([constructBarcode(elementString)]);
      } else {
        toastMessage({ status: Status.warning, message: 'Invalid data for barcode generation' });
      }
    }
  }, [props.data, props.dataPath]);

  const validateData = (aiData: any) => {
    if (!aiData) return false;
    if (!aiData.primary || !aiData.primary.ai || !aiData.primary.value) return false;
    const identifierSchemesForBarcode = (appConfig.identifierSchemes || []).filter(
      (scheme) => scheme.carriers && scheme.carriers.includes(DataCarrierType.Barcode),
    );
    if (identifierSchemesForBarcode.length === 0) return false;

    return identifierSchemesForBarcode.some((scheme) => {
      const regex = new RegExp(scheme.format);
      if (regex.test(aiData.primary.value)) {
        return true;
      }
      return false;
    });
  };

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
      {values.map((item, idx) => {
        return (
          <Box key={idx}>
            <Barcode value={item} />
          </Box>
        );
      })}
    </Box>
  );
};
