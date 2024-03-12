import { createConfigFile } from '../build/interfaces/cli/createConfigFile.js';

createConfigFile()
  .then(() => {
    console.log('Config file created successfully!');
  })
  .catch(() => {
    throw new Error('Error creating config file');
  });
