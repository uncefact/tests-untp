import { Checkbox, FormControl, FormControlLabel, FormGroup, FormLabel } from '@mui/material';
import React, { useEffect, useState } from 'react';
import { getCaseInsensitive } from './utils.js';

type CheckboxData = {
  label: string;
  value: any;
};
interface CheckboxFieldProps {
  onChange: (arg: { data: object }) => void;
}

export const ConformityCredentialCheckbox = ({ onChange }: CheckboxFieldProps) => {
  const initialState = {} as { [key: string]: boolean };

  const [isCheck, setIsCheck] = useState(initialState);
  const [checkList, setCheckList] = useState<string[]>([]);
  const [data, setData] = useState<CheckboxData[]>();

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    let newArray = [...checkList, event.target.name];

    if (checkList.includes(event.target.name)) {
      newArray = newArray.filter((item) => item !== event.target.name);
    }

    setCheckList(newArray);
    setIsCheck({
      ...isCheck,
      [event.target.name]: event.target.checked,
    });

    const selectedItems = data?.filter((item) => newArray.includes(item.label));
    const transformedData ={
      conformityCredential: selectedItems?.map((item) => ({ [item.label]: item.value }))
    }
    // onChange({ data: selectedItems ?? [] });
    onChange({ data: transformedData ?? [] });
  };

  useEffect(() => {
    const path = window.location.pathname;
    let parts = path.split('/'); // ["", "farm", "digital-livestock"]
    let category = parts[1].toLowerCase();

    const getConformityCredential = localStorage.getItem('conformityCredentials');
    const data = JSON.parse(getConformityCredential as string) ?? {};
    const credentials = getCaseInsensitive(data, category);
    const mapCredentials =
      credentials?.map((item: any) => ({
        value: item.url ?? 0,
        label: item.name ?? '',
      })) ?? [];

    setData(mapCredentials);
  }, []);

  return (
    <FormControl component='fieldset'>
      <FormLabel component='legend'>Conformity Credential</FormLabel>
      {data?.map(({ label, value }: CheckboxData, index: number) => (
        <FormGroup key={index}>
          <FormControlLabel
            control={<Checkbox checked={isCheck[index]} onChange={handleChange} name={label} value={value} />}
            label={label}
          />
        </FormGroup>
      ))}
    </FormControl>
  );
};
