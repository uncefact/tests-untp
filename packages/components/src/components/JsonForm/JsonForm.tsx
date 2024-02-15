import React, { useState } from 'react';
import { materialRenderers, materialCells } from '@jsonforms/material-renderers';
import { JsonForms } from '@jsonforms/react';
import { JsonSchema, UISchemaElement } from '@jsonforms/core';
import { IComponentFunc } from '../../types';

/**
 * The props for the JsonForm component
 * @typedef IRenderJsonSchemaProps
 * @property {Object} schema - The json schema.
 * @property {Object} [uiSchema] - The ui schema.
 * @property {Object} [initialData] - The initial data.
 * @property {string} [className] - The class name.
 * @property {Function} onChange - The function to be called when the form changes.
 */
export interface IJsonFormProps extends IComponentFunc {
  schema: JsonSchema;
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
    errors.length > 0 ? onChange({ data, errors }) : onChange({ data });
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
