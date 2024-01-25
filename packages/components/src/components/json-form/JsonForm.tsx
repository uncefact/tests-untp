import React, { useState } from 'react';
import { materialRenderers, materialCells } from '@jsonforms/material-renderers';
import { JsonForms } from '@jsonforms/react';
import { JsonSchema, UISchemaElement } from '@jsonforms/core';

/**
 * The props for the JsonForm component.
 * @typedef IRenderJsonSchemaProps
 * @property {Object} schema - The json schema.
 * @property {Object} [uiSchema] - The ui schema.
 * @property {Object} [initialData] - The initial data.
 * @property {Function} onChangeJsonSchemaForm - The callback to be called when the form changes.
 */
interface IRenderJsonSchemaProps {
  schema: JsonSchema;
  uiSchema?: UISchemaElement;
  initialData?: any;

  onChangeJsonSchemaForm: ({ errors, data }: { errors: any[]; data: any }) => void;
}

interface IJsonForm extends React.HTMLAttributes<HTMLDivElement> {
  jsonData: IRenderJsonSchemaProps;
}

/**
 * Receive a json schema and render a form.
 * @param {Object} props - The component props.
 * @param {Object} props.jsonData - The json data to render the form.
 * @param {string} props.className - The component class name.
 * @returns {React.ReactElement} The rendered component.
 */
export const JsonForm = ({ jsonData, className, ...props }: IJsonForm) => {
  const [data, setData] = useState(jsonData.initialData);

  const onChange = ({ errors, data }: { errors: any[]; data: any }) => {
    setData(data);
    jsonData.onChangeJsonSchemaForm({ data, errors });
  };

  return (
    <div className={className} {...props}>
      <JsonForms
        schema={jsonData.schema}
        uischema={jsonData.uiSchema}
        data={data}
        renderers={materialRenderers}
        cells={materialCells}
        onChange={onChange}
      />
    </div>
  );
};
