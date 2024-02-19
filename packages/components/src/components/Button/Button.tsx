import { Button } from '@mui/material';

type ButtonProps = {
  onClick: () => void;
  label?: string;
};

// TODO: convert variant to receive from props, currently it's hard coded
export const CustomButton: React.FC<ButtonProps> = ({ onClick, label = 'Submit', ...props }) => {
  return (
    <div {...props}>
      <Button variant='contained' onClick={onClick}>
        {label}
      </Button>
    </div>
  );
};
