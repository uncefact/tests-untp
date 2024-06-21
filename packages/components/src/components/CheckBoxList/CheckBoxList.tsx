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
  const [checkList, setCheckList] = useState<{ [key: string]: { value: any; checked: boolean } }>(data);

  useEffect(() => {
    const checkListData = { ...data };
    for (const key in checkListData) {
      checkListData[key] = { value: checkListData[key] };
    }

    setCheckList(checkListData);
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

    const selectedItems = Object.keys(checkList)
      .filter((key) => checkList[key].checked)
      .reduce((objectItems, key) => ({ ...objectItems, [key]: checkList[key].value }), {});
    onChange(selectedItems);
  };

  const renderCheckBoxList = () =>
    Object.keys(checkList).map((key) => {
      const { value, checked } = checkList[key];
      return (
        <FormGroup key={key}>
          <FormControlLabel
            control={<Checkbox checked={checked} onChange={handleChange} key={key} name={key} value={value} />}
            label={key}
          />
        </FormGroup>
      );
    });

  return (
    <Box
      sx={{
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
