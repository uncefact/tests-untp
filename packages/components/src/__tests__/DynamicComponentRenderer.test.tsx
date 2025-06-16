import React from 'react';
import { render, screen } from '@testing-library/react';
import { DynamicComponentRenderer, ComponentType } from '../components/DynamicComponentRenderer/DynamicComponentRenderer';

jest.mock('../components/index', () => ({
  RenderCheckList: (props: any) => <div>RenderCheckList {props.test}</div>,
  ImportButton: () => <div>ImportButton</div>,
}));

describe('render DynamicComponentRenderer component', () => {
  it('Should dynamically load the correct component based on the \'name\' prop', () => {
    // Render the DynamicComponentRenderer component with the 'name' prop set to 'ImportButton'
    render(<DynamicComponentRenderer name='ImportButton' type={ComponentType.EntryData} props={{}} />);
  
    // Assert that the text 'ImportButton' is present in the document, indicating that the correct component was loaded
    expect(screen.getByText('ImportButton')).toBeInTheDocument();
  });
  
  it('Should pass the \'props\' prop to the dynamically loaded component', () => {
    // Render the DynamicComponentRenderer component with the 'name' prop set to 'RenderCheckList' and the 'props' prop set to { test: 'test' }
    render(<DynamicComponentRenderer name='RenderCheckList' type={ComponentType.EntryData} props={{ test: 'test'}} />);
  
    // Assert that the text 'RenderCheckList test' is present in the document, indicating that the 'props' prop was passed to the dynamically loaded component
    expect(screen.getByText('RenderCheckList test')).toBeInTheDocument();
  });
  
  it('Should return null if the component specified by the \'name\' prop does not exist in the components package', () => {
    // Render the DynamicComponentRenderer component with the 'name' prop set to 'InvalidComponent'
    render(<DynamicComponentRenderer name='InvalidComponent' type={ComponentType.EntryData} props={{}} />);
  
    // Assert that the text 'InvalidComponent' is not present in the document, indicating that the component did not render
    expect(screen.queryByText('InvalidComponent')).toBeNull();
  });
  
  it('Should update the dynamically loaded component when the \'name\' prop changes', () => {
    // Render the DynamicComponentRenderer component with the 'name' prop set to 'ImportButton'
    const { rerender } = render(<DynamicComponentRenderer name='ImportButton' type={ComponentType.EntryData} props={{}} />);
  
    // Assert that the text 'ImportButton' is present in the document
    expect(screen.getByText('ImportButton')).toBeInTheDocument();
  
    // Re-render the DynamicComponentRenderer component with the 'name' prop set to 'RenderCheckList'
    rerender(<DynamicComponentRenderer name='RenderCheckList' type={ComponentType.EntryData} props={{ test: 'test'}} />);
  
    // Assert that the text 'RenderCheckList test' is present in the document, indicating that the component was updated
    expect(screen.getByText('RenderCheckList test')).toBeInTheDocument();
  });
  
  it('Should render the \'EntryData\' component when the \'type\' prop is \'EntryData\'', () => {
    // Render the DynamicComponentRenderer component with the 'type' prop set to 'EntryData'
    render(<DynamicComponentRenderer name='ImportButton' type={ComponentType.EntryData} props={{}} />);
  
    // Assert that the text 'ImportButton' is present in the document, indicating that the 'EntryData' component was rendered
    expect(screen.getByText('ImportButton')).toBeInTheDocument();
  });
  
  it('Should render the \'Void\' component when the \'type\' prop is \'Void\'', () => {
    // Render the DynamicComponentRenderer component with the 'type' prop set to 'Void'
    render(<DynamicComponentRenderer name='ImportButton' type={ComponentType.Void} props={{}} />);
  
    // Assert that the text 'ImportButton' is present in the document, indicating that the 'Void' component was rendered
    expect(screen.getByText('ImportButton')).toBeInTheDocument();
  });
  
  it('Should render the \'Submit\' component when the \'type\' prop is \'Submit\'', () => {
    // Render the DynamicComponentRenderer component with the 'type' prop set to 'Submit'
    render(<DynamicComponentRenderer name='ImportButton' type={ComponentType.Submit} props={{}} />);
  
    // Assert that the text 'ImportButton' is present in the document, indicating that the 'Submit' component was rendered
    expect(screen.getByText('ImportButton')).toBeInTheDocument();
  });

});
