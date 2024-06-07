import { Button } from '@mui/material';

type ButtonProps = {
  onClick: () => void;
  label?: string;
};

export const CustomButton: React.FC<ButtonProps> = ({ onClick, label = 'Submit', ...props }) => {
  return (
    <Button onClick={onClick} {...props}>
      {label}
    </Button>
  );
};
