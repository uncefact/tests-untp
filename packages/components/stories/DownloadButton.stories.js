import React from 'react';
import { DownloadButton, DownloadFileType } from '../src/components/DownloadButton/DownloadButton';

export default {
  title: 'DownloadButton',
  component: DownloadButton,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
  argTypes: {},
};

const args =  {
  fileData: { content: 'Down data!' },
  fileName: 'exampleFile',
  fileExtension: 'json',
  fileType: DownloadFileType.json
};

export const Default = {
  args,
  decorators: [
    (Story) => (
      <div style={{ minWidth: '500px', height: '40vh' }}>
          <Story />
      </div>
    ),
  ],
};
