
### Cypress Architecture

Structure in E2E folder:

- Cypress Configuration:
  - `cypress.config.js`: Contains the configuration for Cypress.
  - `tsconfig.json`: Contains the TypeScript configuration for Cypress.
  - `package.json`: Contains the scripts and library for running Cypress.
- Test Files:
  - Tests are organized under cypress/e2e/ . For example:
    - cypress/e2e/issue_workflow_test/DFR/ for DFR related tests.
- Support Files:
  - `e2e.ts`: Contains custom commands for Cypress.
  - `index.ts`: Contains the setup for Cypress.
- Fixtures:
  - JSON files for test data are stored in cypress/fixtures/.

### Clean up data

- Currently, the E2E tests clean up the data by delete minio folder, which bind mounts data from docker-compose file.
