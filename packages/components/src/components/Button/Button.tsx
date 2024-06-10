import { LoadingButton } from '@mui/lab';
import { useState } from 'react';
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
      await onClick();
      setLoading(false);
    } catch (error) {
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
    </div>
  );
};
