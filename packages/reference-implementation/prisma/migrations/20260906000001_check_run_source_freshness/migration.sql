-- Record the source freshness outcome on a verification generation (#957).
-- The timestamp distinguishes an attempted comparison from one that has not
-- yet been made. Both fields are nullable because native runs and older
-- external generations have no source comparison.

ALTER TABLE "CheckRun"
ADD COLUMN "sourceChanged" BOOLEAN,
ADD COLUMN "lastSourceCheckAt" TIMESTAMP(3);
