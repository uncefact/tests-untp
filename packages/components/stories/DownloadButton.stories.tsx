import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { DownloadButton, DownloadFileType } from '../src/components/DownloadButton/DownloadButton';

const meta: any = {
  title: 'DownloadButton',
  component: DownloadButton,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
  argTypes: {},
} satisfies Meta<typeof DownloadButton>;

export default meta;
type Story = StoryObj<typeof meta>;

const args =  {
  fileData: { content: 'Down data!' },
  fileName: 'exampleFile',
  fileExtension: 'json',
  fileType: DownloadFileType.json
};

export const Default: Story = {
  args,
  decorators: [
    (Story) => (
      <div style={{ minWidth: '500px', height: '40vh' }}>
          <Story />
      </div>
    ),
  ],
};
