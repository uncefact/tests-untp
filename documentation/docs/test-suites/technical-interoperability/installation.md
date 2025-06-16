---
sidebar_position: 3
title: Installation
---

import Disclaimer from '../../\_disclaimer.mdx';

<Disclaimer />

Before you begin installing the Tier 1 test suite, ensure that you have the [dependant services](/docs/mock-apps/dependent-services/) and the following prerequisites in place:

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

Once you have met the prerequisites, follow these steps to install the test suite dependencies:

1. Navigate to the cloned repository directory:

   ```
   cd tests-untp/packages/vc-test-suite
   ```

2. Install the dependencies using Yarn:

   ```
   yarn install
   ```

3. Create a folder named reports:
   ```
   mkdir reports
   ```

After completing these steps, you will have all the necessary dependencies for the internal test suite installed.
