import React, { ChangeEvent, useEffect, useState } from 'react';
import { Box, Checkbox, FormControl, FormControlLabel, FormGroup, FormLabel } from '@mui/material';

export interface ICheckBoxes {
  [key: string]: any;
}
export interface ICheckBoxList {
  label?: string;
  data: ICheckBoxes;
  onChange: (data: any) => void;
}

export const CheckBoxList = ({ label = 'CheckBoxList', data, onChange }: ICheckBoxList) => {
  const [checkList, setCheckList] = useState<{ [key: string]: { value: any, checked: boolean } }>(data);

  useEffect(() => {
    for (const key in data) {
      data[key] = { value: data[key] }; 
    }

    setCheckList(data);
  }, [data]);

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const changedCheckBox = checkList[event.target.name];
    if (!changedCheckBox) {
      return;
    }

    checkList[event.target.name] = {
      ...changedCheckBox,
      checked: event.target.checked,
    };

    setCheckList(checkList);
    onChange(checkList);
  };

  const renderCheckBoxList = () => Object.keys(data).map((key) => {
    const { value, checked } = data[key];
    return (
      <FormGroup key={key}>
        <FormControlLabel
          control={<Checkbox checked={checked} onChange={handleChange} name={key} value={value} />}
          label={key}
        />
      </FormGroup>
    );
  })

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
        {renderCheckBoxList()}
      </FormControl>
    </Box>
  );
};
