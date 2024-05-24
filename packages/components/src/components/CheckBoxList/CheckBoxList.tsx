import React, { ChangeEvent, useState } from 'react';
import { Box, Checkbox, FormControl, FormControlLabel, FormGroup, FormLabel } from '@mui/material';

export interface ICheckBoxList {
  label?: string;
  data: { label: string; value: any; }[];
  onChange: (data: object[]) => void;
}

export const CheckBoxList = ({ label = 'CheckBoxList', data, onChange }: ICheckBoxList) => {
  const [isCheck, setIsCheck] = useState<{ [key: string]: boolean }>({});
  const [checkList, setCheckList] = useState<string[]>([]);

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    let newArray = [...checkList, event.target.name];

    if (checkList.includes(event.target.name)) {
      newArray = newArray.filter((item) => item !== event.target.name);
    }

    setCheckList(newArray);
    setIsCheck({
      ...isCheck,
      [event.target.name]: event.target.checked,
    });

    const selectedItems = data.filter((item) => newArray.includes(item.label));

    onChange(selectedItems);
  };

  return (
    <Box
      sx={{
        paddingTop: '95px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
      }}
    >
      <FormControl component='fieldset'>
        <FormLabel component='legend'>{label}</FormLabel>
        {data.map(({ label, value }, index: number) => (
          <FormGroup key={index}>
            <FormControlLabel
              control={<Checkbox checked={isCheck[index]} onChange={handleChange} name={label} value={value} />}
              label={label}
            />
          </FormGroup>
        ))}
      </FormControl>
    </Box>
  );
};
