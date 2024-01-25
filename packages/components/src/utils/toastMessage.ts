import { toast } from 'react-toastify';
import { Status } from '../models';

export function toastMessage({ status, message }: {
  status: Status;
  message: string;
}) {
  toast[status](message, {
    position: 'top-right',
    hideProgressBar: true,
    closeOnClick: true,
    pauseOnHover: true,
    draggable: true,
    autoClose: 3000,
  });
}