import React, { useEffect, useState } from 'react';
import { materialRenderers, materialCells } from '@jsonforms/material-renderers';
import { JsonForms } from '@jsonforms/react';
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
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
  const [ajv, setAjv] = useState<Ajv2020>();
  useEffect(() => {
    initialise();
  }, [schema]);

  const initialise = () => {
    const ajv = new Ajv2020({
      allErrors: true,
      strict: false,
    });
    addFormats(ajv);

    try {
      const validate = ajv.compile(schema);

      setAjv(ajv);
      console.log(validate.errors);
    } catch (error: any) {
      console.error(error.message);
    }
  };

  const handleChange = ({ errors, data }: { errors: any[]; data: any }) => {
    setData(data);
    errors.length > 0 ? onChange({ data, errors }) : onChange({ data });
  };

  return (
    <div className={className} {...props}>
      {ajv ? (
        <JsonForms
          ajv={ajv}
          schema={schema}
          uischema={uiSchema}
          data={data}
          renderers={materialRenderers}
          cells={materialCells}
          onChange={handleChange}
        />
      ) : null}
    </div>
  );
};
