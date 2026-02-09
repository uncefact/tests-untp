import type { Meta, StoryObj } from '@storybook/react-webpack5';
import { Loader } from './Loader';

const meta = {
  title: 'Components/Utility/Loader',
  component: Loader,
  parameters: {
    layout: 'centered',
  },
  decorators: [
    (Story) => (
      <div className='w-[400px] h-[300px] bg-background border border-border rounded-lg p-8'>
        <Story />
      </div>
    ),
  ],
  argTypes: {
    text: {
      control: 'text',
      description: 'Optional text to display below the spinner',
    },
    size: {
      control: { type: 'number', min: 16, max: 80, step: 4 },
      description: 'Size of the spinner icon in pixels',
    },
    className: {
      control: 'text',
      description: 'Additional CSS classes to apply to the container',
    },
  },
} satisfies Meta<typeof Loader>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {},
};

export const WithText: Story = {
  args: {
    text: 'Loading...',
  },
};

export const WithLongText: Story = {
  args: {
    text: 'Loading your data, please wait...',
  },
};

export const SmallSize: Story = {
  args: {
    text: 'Loading...',
    size: 24,
  },
};

export const LargeSize: Story = {
  args: {
    text: 'Loading...',
    size: 64,
  },
};

export const FullScreen: Story = {
  args: {
    text: 'Loading application...',
    className: 'min-h-screen',
  },
  decorators: [
    (Story) => (
      <div className='w-screen h-screen'>
        <Story />
      </div>
    ),
  ],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        story: "Example of a full-screen loader. Use `className='min-h-screen'` for full viewport height.",
      },
    },
  },
};

export const CustomStyling: Story = {
  args: {
    text: 'Please wait...',
    className: 'bg-slate-50 rounded-lg p-8 border-2 border-blue-200',
  },
  parameters: {
    docs: {
      description: {
        story: 'You can apply custom styling via the className prop for backgrounds, borders, padding, etc.',
      },
    },
  },
};
