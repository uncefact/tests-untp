import { ToastContainer, toast } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';

// An enumeration for different toast statuses
export enum Status {
  success = 'success',
  error = 'error',
  warning = 'warning',
  info = 'info',
};

// The function for displaying toast messages
export function toastMessage({ status, message, linkURL }: {
  status: Status;
  message: string;
  linkURL: string;
}): void {
  toast[status](
  <div style={{display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'}}>
    <div>
      {message}
    </div>
    {linkURL && <a style={{fontSize: '12px'}} href={linkURL} target="_blank">Open VC</a> }
  </div>, 
  {
    position: 'top-right',
    hideProgressBar: true,
    // closeOnClick: true,
    pauseOnHover: true,
    draggable: true,
    autoClose: 4000,
  });
}

// ToastMessage component for displaying a ToastContainer
export const ToastMessage = () => {
  return <ToastContainer />;
};