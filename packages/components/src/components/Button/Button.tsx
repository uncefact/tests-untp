import React, { useState } from 'react';
import { ToastContainer, toast } from 'react-toastify';
import { LoadingButton } from '@mui/lab';

import { DownloadButton } from '../DownloadButton/DownloadButton.js';
import { VerifiableCredential } from '@vckit/core-types';

type ButtonProps = {
  onClick: () => void;
  label?: string;
  nestedComponent?: any;
};

const components = {
  DownloadButton: DownloadButton,
};

// TODO: convert variant to receive from props, currently it's hard coded
export const CustomButton: React.FC<ButtonProps> = ({ onClick, label = 'Submit', ...props }) => {
  const [credential, setCredential] = useState({} as VerifiableCredential | {});
  const [isLoading, setIsLoading] = useState(false);

  const handleOnClick = async () => {
    setCredential({});
    setIsLoading(true);
    try {
      const value = (await onClick()) as unknown as VerifiableCredential;
      setCredential(value);
      toast.success('Successfully issue VC and upload to storage!');
    } catch (error) {
      const e = error as Error;
      toast.error(e.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div {...props}>
      <LoadingButton loading={isLoading} variant='contained' onClick={handleOnClick}>
        {label}
      </LoadingButton>

      {props.nestedComponent &&
        credential &&
        Object.keys(credential).length > 0 &&
        React.createElement((components as any)[props.nestedComponent.name], {
          fileData: credential,
          ...props.nestedComponent.props,
        })}

      <ToastContainer />
    </div>
  );
};
