import { LoadingButton } from '@mui/lab';
import { useState } from 'react';
import { Status, ToastMessage, toastMessage } from '../ToastMessage/ToastMessage.js';
import { Tooltip } from '@mui/material';

type ButtonProps = {
  onClick: () => any;
  label?: string;
  description?: string;
};

export const CustomButton: React.FC<ButtonProps> = ({ onClick, label = 'Submit', ...props }) => {
  const [loading, setLoading] = useState(false);

  const handleOnClick = async () => {
    setLoading(true);

    try {
      const res = await onClick();

      if (res) {
        toastMessage({ status: Status.success, message: 'Success' });
      } else {
        toastMessage({ status: Status.error, message: 'Failed' });
      }

      setLoading(false);
    } catch (error) {
      const e = error as Error;
      toastMessage({ status: Status.error, message: 'Something when wrong: ' + e.message });
      setLoading(false);
    }
  };

  return (
    <div {...props}>
      <Tooltip title={props.description}>
        <LoadingButton loading={loading} variant='contained' onClick={handleOnClick}>
          {label}
        </LoadingButton>
      </Tooltip>
      <ToastMessage />
    </div>
  );
};
