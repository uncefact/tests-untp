import React, { useEffect, useState } from 'react';
import Ajv2020 from 'ajv/dist/2020.js';
import { ToastContainer, toast } from 'react-toastify';
import { materialRenderers, materialCells } from '@jsonforms/material-renderers';
import { JsonForms } from '@jsonforms/react';
import { JsonSchema, UISchemaElement } from '@jsonforms/core';
import { CircularProgress } from '@mui/material';

import { IComponentFunc } from '../../types';

/**
 * The props for the JsonForm component
 * @typedef IRenderJsonSchemaProps
 * @property {JsonSchema | { url: string }} schema - The json schema should be an object or an object with a url property.
 * @property {Object} [uiSchema] - The ui schema.
 * @property {Object} [data] - The initial data.
 * @property {string} [className] - The class name.
 * @property {Function} onChange - The function to be called when the form changes.
 */
export interface IJsonFormProps extends IComponentFunc {
  schema: JsonSchema | { url: string };
  uiSchema?: UISchemaElement;
  data?: any;
  className?: string;
}

/**
 * Receive a json schema and render a form.
 * @returns {React.ReactElement} The rendered component.
 */
export const JsonForm = ({ schema, uiSchema, data: initialData, onChange, className, ...props }: IJsonFormProps) => {
  const [data, setData] = useState();
  const [schemaInfo, setSchemaInfo] = useState<JsonSchema>({});
  const [isLoading, setIsLoading] = useState(true);
  const ajv = new Ajv2020({
    strict: false,
  });

  const handleChange = ({ errors, data }: { errors: any[]; data: any }) => {
    setData(data);
    errors.length > 0 ? onChange({ data, errors }) : onChange({ data });
  };

  /**
   * Detect the schema and set the schema info, if the schema is an object with a url property, fetch the schema.
   * @returns {Promise<void>} The detected schema.
   */
  const detectSchema = async () => {
    setIsLoading(true);
    try {
      if ((schema as { url: string }).hasOwnProperty('url')) {
        const response = await fetch((schema as { url: string }).url);
        const data = await response.json();
        if (data) {
          setSchemaInfo(data as JsonSchema);
        }
      } else {
        setSchemaInfo(schema as JsonSchema);
      }
    } catch (error) {
      toast.error('Error setup schema');
      console.error('Error:', error);
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * Detect the data and set the data, if the data is an object with a url property, fetch the data.
   * Please make sure to set up the identifierKeyPath correctly in app-config.json.
   */
  const detectData = async () => {
    setIsLoading(true);
    try {
      if (initialData.hasOwnProperty('url')) {
        const response = await fetch(initialData.url);
        const data = await response.json();
        if (data) {
          setData(data);
        }
      } else {
        setData(initialData);
      }
    } catch (error) {
      toast.error('Error setup data');
      console.error('Error:', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    detectSchema();
    detectData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className={className} {...props}>
      {isLoading ? (
        <section style={{ textAlign: 'center' }}>
          <CircularProgress />
        </section>
      ) : (
        <JsonForms
          ajv={ajv}
          schema={schemaInfo}
          uischema={uiSchema}
          data={data}
          renderers={materialRenderers}
          cells={materialCells}
          onChange={handleChange}
        />
      )}
      <ToastContainer />
    </div>
  );
};
