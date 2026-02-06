import React from 'react';
import { Button, Dialog, DialogActions, DialogContent, DialogTitle } from '@mui/material';

export interface ICustomDialogStyle {
  content?: React.CSSProperties;
  title?: React.CSSProperties;
  actions?: React.CSSProperties;
}

export interface ICustomDialog {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  content?: React.ReactNode;
  buttons?: React.ReactNode;
  style?: ICustomDialogStyle;
}

/**
 * CustomDialog component is used to show the custom dialog
 */
const CustomDialog = ({ open, onClose, title, content, buttons, style }: ICustomDialog) => {
  return (
    <Dialog open={open} onClose={onClose}>
      <DialogTitle sx={{ ...style?.title }}>{title}</DialogTitle>
      <DialogContent sx={{ ...style?.content }}>{content}</DialogContent>
      <DialogActions sx={{ ...style?.actions }}>
        {/* Render any buttons you want here */}
        <Button onClick={onClose}>Close</Button>
        {buttons}
      </DialogActions>
    </Dialog>
  );
};

export default React.memo(CustomDialog);
