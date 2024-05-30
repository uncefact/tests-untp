import { LoadingButton } from '@mui/lab';
import { useState } from 'react';
import { Status, ToastMessage, toastMessage } from '../ToastMessage/ToastMessage.js';

type ButtonProps = {
  onClick: () => any;
  label?: string;
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
      <LoadingButton loading={loading} variant='contained' onClick={handleOnClick}>
        {label}
      </LoadingButton>

      <ToastMessage />
    </div>
  );
};
