---
sidebar_position: 3
title: Installation
---

import Disclaimer from '.././\_disclaimer.mdx';

<Disclaimer />

Before you begin installing the mock apps, ensure that you have the following prerequisites in place:

### Prerequisites

1. Clone the repository: 
   ```
   git clone https://github.com/uncefact/tests-untp.git
   ```

2. Node.js version 20.12.2: Make sure you have Node.js version 20.12.2 installed on your system. You can download it from the official Node.js website: [https://nodejs.org](https://nodejs.org)

3. Yarn version 1.22.22: Ensure that you have Yarn version 1.22.22 installed. You can install it by running the following command:
   ```
   npm install -g yarn@1.22.22
   ```

### Installation Steps

Once you have met the prerequisites, follow these steps to install the dependencies:

1. Navigate to the cloned repository directory:
   ```
   cd tests-untp
   ```

2. Install the dependencies using Yarn:
   ```
   yarn install
   ```

3. Copy the example configuration file:
   ```
   cp packages/mock-app/src/constants/app-config.example.json packages/mock-app/src/constants/app-config.json
   ```

This command copies the example configuration file `app-config.example.json` to create the actual configuration file `app-config.json` that will be used by the mock apps.

After completing these steps, you will have all the necessary mock app dependencies installed and the configuration file ready for customisation.

In the next section, we will explore the required services and their documentation to help you understand their role in the mock apps ecosystem.