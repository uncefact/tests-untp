import React, { useState } from 'react';
import { materialRenderers, materialCells } from '@jsonforms/material-renderers';
import { JsonForms } from '@jsonforms/react';
import { JsonSchema, UISchemaElement } from '@jsonforms/core';

/**
 * The props for the JsonForm component.
 * @typedef IRenderJsonSchemaProps
 * @property {Object} schema - The json schema.
 * @property {Function} onChange - The callback to be called when the form changes.
 * @property {Object} [uiSchema] - The ui schema.
 * @property {Object} [initialData] - The initial data.
 * @property {string} [className] - The class name.
 */
export interface IJsonFormProps {
  schema: JsonSchema;
  onChange: ({ errors, data }: { errors: any[]; data: any }) => void;
  uiSchema?: UISchemaElement;
  initialData?: any;
  className?: string;
}

/**
 * Receive a json schema and render a form.
 * @returns {React.ReactElement} The rendered component.
 */
export const JsonForm = ({ schema, uiSchema, initialData, onChange, className, ...props }: IJsonFormProps) => {
  const [data, setData] = useState(initialData);

  const handleChange = ({ errors, data }: { errors: any[]; data: any }) => {
    setData(data);
    onChange({ data, errors });
  };

  return (
    <div className={className} {...props}>
      <JsonForms
        schema={schema}
        uischema={uiSchema}
        data={data}
        renderers={materialRenderers}
        cells={materialCells}
        onChange={handleChange}
      />
    </div>
  );
};
