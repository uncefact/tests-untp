type ButtonProps = {
  onClick: () => void;
};
export const Button: React.FC<ButtonProps> = ({ onClick }) => {
  return <button onClick={onClick}>Click me!</button>;
};

