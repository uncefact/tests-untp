import { ToastContainer, toast } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';

// An enumeration for different toast statuses
export enum Status {
  success = 'success',
  error = 'error',
  warning = 'warning',
  info = 'info',
}

// The function for displaying toast messages
export function toastMessage({ status, message }: { status: Status; message: string }): void {
  toast[status](message, {
    position: 'top-right',
    hideProgressBar: true,
    closeOnClick: true,
    pauseOnHover: true,
    draggable: true,
    autoClose: 3000,
  });
}

// ToastMessage component for displaying a ToastContainer
export const ToastMessage = () => {
  return <ToastContainer />;
};
