import { untp } from './untp.js';

if (!process.argv.slice(2).length) {
  untp.outputHelp();
} else {
  untp.parse(process.argv);
}
