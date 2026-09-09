// Registered as a jest `setupFiles` entry, so this pin applies to every
// integration suite in this package, not only the batch-get suite. The value 5
// keeps the over-limit case small enough to seed. The maximum is read when
// `batch-limits.ts` first loads, so a suite that needs the shipped default of
// 500 would have to reset both this variable and the module registry.
process.env.API_MAX_BATCH_GET_IDS = '5';
