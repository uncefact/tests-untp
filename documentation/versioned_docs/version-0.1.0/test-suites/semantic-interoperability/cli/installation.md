---
sidebar_position: 4
title: Installation
---

import Disclaimer from './../../../\_disclaimer.mdx';

<Disclaimer />

Before you begin installing the Tier 2 test suite CLI, ensure that you have the following prerequisites in place:

### Prerequisites

1. Clone the repository: 
   ```
   git clone https://github.com/uncefact/tests-untp.git
   ```

2. Node.js version 20.12.2: Make sure you have Node.js version 20.12.2 installed on your system. You can download it from the official Node.js website: [https://nodejs.org](https://nodejs.org)

3. Yarn version 1.22.17: Ensure that you have Yarn version 1.22.17 installed. You can install it by running the following command:
   ```
   npm install -g yarn@1.22.17
   ```

### Installation Steps

Once you have met the prerequisites, follow these steps to install the dependencies:

1. Navigate to the cloned repository directory:
   ```
   cd tests-untp/packages/untp-test-suite
   ```

2. Install the dependencies using Yarn:
   ```
   yarn install
   ```

3. Build the test suite:
   ```
   yarn build
   ```

After completing these steps, you will have all the necessary dependencies installed.

In the next section, we will initialise and explore the configuration file for the test suite.