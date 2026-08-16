import { main, prisma, logger } from './seed.js';

/**
 * The seed's actual CLI entrypoint (`tsx seed-cli.ts`). `seed.ts` exports
 * `main` and `prisma` without running them, so the integration suite can
 * import and drive the real decision path against the rig database; this
 * file supplies the process-level behaviour (exit code, disconnect) that
 * only makes sense when actually running as a script.
 *
 * `process.exit()` terminates the process immediately, abandoning any
 * pending microtask, so it must run after `prisma.$disconnect()` settles,
 * never inside a `.catch()` that a chained `.finally()` follows: `.finally`
 * would never get the chance to run. Recording the exit code and exiting
 * only once the disconnect has resolved is what keeps the connection
 * closed on every path, success and failure alike.
 */
main()
  .then(
    () => 0,
    (e) => {
      logger.error({ err: e }, 'Seed failed');
      return 1;
    },
  )
  .then(async (exitCode) => {
    await prisma.$disconnect();
    process.exit(exitCode);
  });
